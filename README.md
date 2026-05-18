# Proposta Arquitetural: Sistema de Agenda Híbrido (ERP Local + Nuvem)

Esta proposta define a arquitetura, estrutura e o fluxo de dados para o sistema de agendamentos inspirado na "Avante Agenda", garantindo que ele funcione como extensão do ERP atual (Firebird) e prepare terreno para agendamentos online (PostgreSQL).

---

## 1. Arquitetura Recomendada

A arquitetura adotará o padrão **Híbrido (Edge to Cloud)** para garantir o funcionamento offline no cliente e a disponibilidade online.

*   **Ambiente Local (Cliente / ERP)**:
    *   **Banco de Dados**: Firebird (o mesmo utilizado pelo ERP atual). A entidade principal da agenda no Firebird será a **Ordem de Serviço (OS)**.
    *   **API Local & Sync Agent**: Um serviço rodando localmente no servidor do cliente. Ele serve de *backend* para a aplicação local, grava no Firebird e roda rotinas de sincronização em background. Ele implementa o **Padrão Adapter**, traduzindo o formato de "Agendamento" (visto no calendário) para o formato nativo de "Ordem de Serviço" do ERP.
    *   **Frontend Local**: Aplicação Web que atua tanto como **Módulo Preview** (somente leitura) quanto como **Módulo Acesso Total** (leitura/escrita), acessado pela intranet do cliente.
*   **Ambiente em Nuvem (Online)**:
    *   **Banco de Dados**: PostgreSQL (Arquitetura Multi-Tenant para atender múltiplos clientes em uma única base usando `tenant_id`).
    *   **API Nuvem**: Recebe dados sincronizados pelas APIs locais dos clientes e gerencia as regras para agendamentos externos.
    *   **Frontend Nuvem (Futuro)**: Portal de autoatendimento para o cliente final agendar horários online.

---

## 2. Separação dos Módulos

*   **Módulo Preview Local**:
    *   Autenticação atrelada a perfis de leitura.
    *   Interface desabilita botões de criação, edição e exclusão.
    *   Busca dados via API Local -> Banco Firebird.
    *   Benefício principal: Velocidade instantânea e funcionamento sem internet.
*   **Módulo de Acesso Total (Local)**:
    *   Acessado por gerentes/recepcionistas com permissão de escrita.
    *   Realiza CRUD no Firebird via API Local.
    *   Ao salvar, o agendamento é salvo no Firebird e colocado em uma "fila" (status pendente) para o Sync Agent enviar à nuvem.
*   **Módulo Online (Futuro)**:
    *   Clientes finais acessam pela internet.
    *   Grava diretamente no PostgreSQL, que por sua vez fica aguardando a API Local puxar os novos agendamentos criados online.

---

## 3. Integração Legada: Ordem de Serviço (OS)

Como o ERP não possui uma tabela exclusiva de Agendamentos, utilizaremos a tabela de **Ordem de Serviço (OS)**. Para garantir o sucesso dessa arquitetura, aplicaremos as seguintes regras:

*   **Filtro de Diferenciação**: Para separar uma OS Comum de uma "OS Agendamento", utilizaremos o campo `DATA_PREVISTA` (e possivelmente um Técnico/Profissional alocado). OSs com esses campos preenchidos e válidas para a agenda futura serão interpretadas pelo sistema como agendamentos. *(Nota: Pode-se criar uma View ou Módulo SQL no Firebird para entregar os dados já formatados para a API Local)*.
*   **Adapter Pattern na API**:
    *   **Leitura**: A API Local executa o SQL/View no Firebird (tabela de OS) e traduz os campos (ex: `DATA_PREVISTA` vira `data_hora_inicio`) para o Frontend desenhar o calendário.
    *   **Escrita**: Ao criar um agendamento no Frontend, a API Local executa um `INSERT INTO TB_OS`, preenchendo os campos obrigatórios do ERP para que a OS nasça corretamente estruturada.

---

## 4. Fluxo de Dados e Sincronização

A estratégia recomendada é a **Sincronização Assíncrona Bidirecional Baseada em Eventos**.

1.  **Escrita Local**: Usuário cria agendamento local -> API grava no Firebird (com campo `sync_status = 'PENDENTE'`) -> Serviço em background envia para API Nuvem via HTTP POST -> API Nuvem salva no PostgreSQL -> Serviço local marca como `sync_status = 'SINCRONIZADO'`.
2.  **Escrita Online**: Cliente cria agendamento no portal -> API Nuvem grava no PostgreSQL -> API Local (via *Long Polling* ou WebSockets) detecta novos registros na nuvem -> API Local grava no Firebird.
3.  **Queda de Internet**: O sistema local funciona normalmente. Agendamentos recebem `sync_status = 'PENDENTE'`. Quando a conexão retorna, o Sync Agent esvazia a fila enviando os dados em lote (batch).

---

## 5. Estrutura Inicial das Tabelas

*Nota de Arquitetura:* O banco de dados em Nuvem (PostgreSQL) utilizará **UUIDv4** para segurança e isolamento (Multi-Tenant). Porém, o banco Local (Firebird) continuará utilizando seus geradores nativos numéricos (Inteiros) para a tabela de Ordem de Serviço. A correlação será feita via Sync Agent.

*   **`empresas`** (Apenas Nuvem)
    *   `id` (UUID), `cnpj`, `nome_fantasia`, `ativo`
*   **`profissionais`** (Nuvem) / **`tecnicos`** (Firebird)
    *   `id` (UUID na Nuvem / INT no ERP), `tenant_id`, `nome`, `ativo`
*   **`clientes`**
    *   `id` (UUID na Nuvem / INT no ERP), `tenant_id`, `nome`, `telefone`, `documento`
*   **`agendamentos`** (PostgreSQL na Nuvem)
    *   `id` (UUID)
    *   `tenant_id`
    *   `id_os_local` (INT - Guarda o ID real da Ordem de Serviço gerado no Firebird)
    *   `profissional_id`, `cliente_id`, `servico_id`
    *   `data_hora_inicio` (Timestamp)
    *   `data_hora_fim` (Timestamp)
    *   `status` (Enum: AGENDADO, CONFIRMADO, CANCELADO, CONCLUIDO, FALTOU)
    *   `origem` (Enum: LOCAL, NUVEM)
    *   `sync_status` (Enum: PENDENTE, SINCRONIZADO, ERRO)
    *   `updated_at` (Timestamp)

---

## 6. Endpoints Principais da API

*   **Agendamentos**:
    *   `GET /api/agendamentos`: Retorna agenda (suporta filtros: `data_inicio`, `data_fim`, `profissional_id`, `status`).
    *   `POST /api/agendamentos`: Cria um agendamento.
    *   `PUT /api/agendamentos/:id`: Atualiza dados do agendamento.
    *   `PATCH /api/agendamentos/:id/status`: Altera apenas o status (ex: confirmar, cancelar).
*   **Sync Agent**:
    *   `POST /api/sync/push`: Envia os registros locais com `sync_status = PENDENTE` para a nuvem.
    *   `GET /api/sync/pull`: Busca os registros na nuvem baseando-se na data do último `updated_at` recebido.

---

## 7. Cuidados contra Conflitos de Dados e Integração

Como existem dois bancos (Local e Nuvem) com estratégias de ID diferentes, os seguintes cuidados são **obrigatórios**:

1.  **Mapeamento de IDs (Cross-Reference)**: Como o Firebird usará inteiros para as OSs, a nuvem usará UUIDs. Quando a nuvem cria um agendamento online (UUID xyz), ele desce para o Local. O Local insere a OS, o Firebird gera a OS de número `1540`. O Sync Agent deve retornar à nuvem e atualizar: `UPDATE agendamentos SET id_os_local = 1540 WHERE id = 'xyz'`.
2.  **Soft Delete / Cancelamento**: **NUNCA** exclua um registro fisicamente (`DELETE`). No Firebird, altere o status da OS para "Cancelado". Isso permite que o Sync Agent avise a nuvem para liberar aquele horário.
3.  **Prevenção de Duplo Agendamento (Double Booking)**: 
    *   Ao sincronizar um agendamento da nuvem para o local, o banco local DEVE verificar se não houve uma Ordem de Serviço agendada offline para o mesmo profissional/horário durante a queda de rede.
    *   Se houver conflito, o agendamento mais recente (ou online) recebe um status especial de `CONFLITO - REVISAR`, alertando o usuário no Módulo Local para reagendar ou cancelar uma das OSs.

---

## 8. Tecnologias Sugeridas

*   **Backend (Local e Nuvem)**: **Node.js com TypeScript** (usando *Express* ou *NestJS*). O ecossistema Node.js tem ótima performance para APIs, facilidade de implementação de filas/rotinas em background e bibliotecas excelentes (ex: `node-firebird` para o local e `pg` para nuvem).
*   **Frontend (Local e Nuvem)**: **React com Vite** e **Tailwind CSS**. Garantirá uma estética rica, moderna (efeitos de hover, animações suaves) e a velocidade desejada. Para manipulação do calendário, o uso da biblioteca `FullCalendar` é um padrão de mercado sólido.
*   **Banco em Nuvem**: **PostgreSQL**. Excelente para multi-tenancy (múltiplos clientes) e tipagem rigorosa.

---

## 9. Sugestão de Telas e Estética (Aesthetics)

Para alcançar o nível de **Rich Aesthetics** desejado:
1.  **Dashboard de Calendário**: Interface "Glassmorphism" (efeito de vidro translúcido). O calendário ocupará a maior parte da tela.
    *   Cartões de agendamento com bordas arredondadas e cores suaves baseadas no status.
    *   Micro-interações ao passar o mouse por cima do agendamento (exibindo um balão flutuante rápido com cliente/telefone).
2.  **Filtros Laterais**: Um painel esquerdo ou direito retrátil para seleção rápida de profissionais (com avatares circulares) e check-boxes visuais elegantes para filtrar por "Status".
3.  **Modal de Agendamento**: Ao invés de telas separadas, um *Slide-over* lateral ou Modal centralizado que permite criar o agendamento em 3 cliques, com auto-complete rápido dos dados do cliente.
4.  **Temas**: Suporte total a **Dark Mode** e **Light Mode**, garantindo uma experiência premium e confortável para profissionais que passam o dia inteiro olhando para o sistema.
