const firebird = require('node-firebird');
const fs = require('fs');

const options = {
    host: process.env.FB_HOST || '127.0.0.1',
    port: parseInt(process.env.FB_PORT) || 3050,
    database: process.env.FB_DATABASE || 'C:\\DATAGOO CLIENTES\\Clientes Firebird 3\\Dados\\pet\\DADOS.FDB',
    user: process.env.FB_USER || 'SYSDBA',
    password: process.env.FB_PASSWORD || 'masterkey',
    lowercase_keys: false,
    role: null,
    pageSize: 4096,
    pluginName: 'Srp',
    wireCrypt: 0,
};

function logDebug(message) {
    try {
        const path = require('path');
        const logPath = path.join(__dirname, 'agenda_debug.log');
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`, 'utf8');
    } catch (e) {
        console.error('Falha ao escrever log:', e);
    }
}

function queryDatabase(sql, params = []) {
    return new Promise((resolve, reject) => {
        logDebug(`Iniciando query. Host: ${options.host}, Database: ${options.database}`);
        const isLocalHost = options.host === '127.0.0.1' || options.host === 'localhost';
        if (isLocalHost && options.database && /^[a-zA-Z]:\\/.test(options.database)) {
            if (!fs.existsSync(options.database)) {
                logDebug(`ERRO: Banco de dados não existe no caminho: ${options.database}`);
                return reject(new Error(`O banco de dados não foi encontrado no caminho especificado: "${options.database}". Verifique o arquivo .env no computador do cliente.`));
            }
        }

        let isCompleted = false;
        const timeoutId = setTimeout(() => {
            if (!isCompleted) {
                isCompleted = true;
                logDebug(`ERRO: Tempo limite de conexão de 45 segundos esgotado no host ${options.host}:${options.port}`);
                reject(new Error(`O Firebird não respondeu na porta ${options.port}. O banco pode estar muito pesado ou o IP pode estar incorreto.`));
            }
        }, 45000);

        const connectStart = Date.now();
        try {
            firebird.attach(options, (err, db) => {
                if (isCompleted) {
                    if (db) {
                        try { db.detach(); } catch (e) {}
                    }
                    return;
                }
                clearTimeout(timeoutId);
                isCompleted = true;

                const connectDuration = (Date.now() - connectStart) / 1000;
                if (err) {
                    logDebug(`ERRO de conexão após ${connectDuration}s: ${err.message}`);
                    return reject(new Error(`Falha ao conectar no Firebird: ${err.message}. Verifique se o serviço do Firebird está rodando e se a senha/usuário estão corretos.`));
                }
                logDebug(`Conectado com sucesso ao Firebird em ${connectDuration}s. Executando query...`);

                const queryStart = Date.now();
                db.query(sql, params, (err, result) => {
                    const queryDuration = (Date.now() - queryStart) / 1000;
                    db.detach();
                    
                    if (err) {
                        logDebug(`ERRO de query após ${queryDuration}s: ${err.message}`);
                        return reject(err);
                    }
                    
                    logDebug(`Query executada com sucesso em ${queryDuration}s. Registros retornados: ${result ? result.length : 0}`);
                    resolve(result);
                });
            });
        } catch (catchErr) {
            if (!isCompleted) {
                clearTimeout(timeoutId);
                isCompleted = true;
            }
            logDebug(`Exceção capturada no driver do Firebird: ${catchErr.message}`);
            reject(new Error(`Erro inesperado no driver do Firebird: ${catchErr.message}`));
        }
    });
}

const getAgendamentos = async (empresa) => {
    // A query principal NÃO busca campos BLOBs pesados, deixando a sincronização instantânea!
    const sql = `
        SELECT
            OS.os_id,
            OS.data_criada,
            OS.data_agendamento,
            OS.hora_do_agendamento,
            OS.data_entrega,
            OS.hora_termino,
            cliente.pes_rsocial_nome as Tutor_nome,
            e.teq_descricao as ANIMAL,
            OS.Nome_do_pet,
            OS.Idade_do_pet,
            OS.Raca_do_pet,
            OS.KG_do_pet,
            tecnico.pes_rsocial_nome as tecnico_nome
        FROM (
            SELECT 
                os_id,
                os_dt_emissao as data_criada,
                os_dt_prevista as data_agendamento,
                os_hr_prevista as hora_do_agendamento,
                os_dt_entrega as data_entrega,
                os_hr_entrega as hora_termino,
                os_cliente,
                os_tecnico,
                os_tipo_equipamento,
                os_equip_desc_1 as Nome_do_pet,
                os_equip_desc_2 as Idade_do_pet,
                os_equip_desc_3 as Raca_do_pet,
                os_equip_desc_4 as KG_do_pet
            FROM tb_ordem_servico
            WHERE OS_EMPRESA = ?
              AND os_id > (SELECT COALESCE(MAX(os_id), 0) - 25000 FROM tb_ordem_servico)
              AND os_dt_prevista >= CURRENT_DATE - 90
        ) OS
        left join tb_tipo_equipamento e on e.teq_id = OS.os_tipo_equipamento
        left outer join tb_pessoa cliente on (OS.os_cliente = cliente.pes_id)
        left outer join tb_pessoa tecnico on (OS.os_tecnico = tecnico.pes_id)
    `;

    return await queryDatabase(sql, [empresa]);
};

const getAgendamentoDetalhes = async (id) => {
    // Busca os campos BLOB pesados APENAS de uma única OS de forma instantânea por ID da chave primária!
    const sql = `
        SELECT
            os_id,
            CAST(SUBSTRING(os_obs_defeito FROM 1 FOR 4000) AS VARCHAR(4000)) as diagnostico,
            CAST(SUBSTRING(os_laudo_tecnico FROM 1 FOR 4000) AS VARCHAR(4000)) as laudo
        FROM tb_ordem_servico
        WHERE os_id = ?
    `;
    const result = await queryDatabase(sql, [id]);
    return result && result.length > 0 ? result[0] : null;
};

module.exports = {
    getAgendamentos,
    getAgendamentoDetalhes
};
