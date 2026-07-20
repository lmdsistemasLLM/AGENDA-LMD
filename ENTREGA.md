# ENTREGA - Agenda LMD Preview

## Resumo tecnico

| Componente | Status | Observacao |
| --- | --- | --- |
| Frontend React/Vite | Atualizado | Interface desktop integrada ao backend local |
| Electron | Atualizado | Inicializacao automatica da API e gerenciamento do processo local |
| API Local Python | Atualizada | FastAPI com configuracao persistente, diagnostico Firebird e endpoints de saude |
| Firebird x86/x64 | Atualizado | Builds separados para compatibilidade com DLLs distintas |
| Instalador Windows | Atualizado | Stage e script Inno Setup prontos para empacotamento |
| Identidade visual | Atualizada | `assets/icon.ico` e `assets/logo.png` como fonte oficial |

## Conteudo da entrega

1. Codigo-fonte do frontend, Electron e backend Python.
2. Scripts de build e empacotamento.
3. Suporte a configuracao local persistente.
4. Suporte a diagnostico de `fbclient.dll`.
5. Estrutura do instalador em `installer/`.
6. Arquivos de exemplo `.env` sem credenciais reais.
7. Documentacao principal em `README.md`.

## Observacoes de versionamento

- Artefatos compilados ficam fora do Git.
- DLLs, bancos, logs, executaveis e instaladores nao fazem parte desta entrega fonte.
- A configuracao de licenciamento deve ser definida por ambiente.

## Versao

- Produto: Agenda LMD Preview
- Empresa: LMD Sistemas
- Versao base do codigo: `1.1.1`
