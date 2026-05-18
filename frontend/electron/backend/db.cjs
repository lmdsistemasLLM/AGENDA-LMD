const firebird = require('node-firebird');

const options = {
    host: process.env.FB_HOST || '127.0.0.1',
    port: process.env.FB_PORT || 3050,
    database: process.env.FB_DATABASE || 'C:\\DATAGOO CLIENTES\\Clientes Firebird 3\\Dados\\pet\\DADOS.FDB',
    user: process.env.FB_USER || 'SYSDBA',
    password: process.env.FB_PASSWORD || 'masterkey',
    lowercase_keys: false,
    role: null,
    pageSize: 4096,
};

function queryDatabase(sql, params = []) {
    return new Promise((resolve, reject) => {
        firebird.attach(options, (err, db) => {
            if (err) return reject(err);

            db.query(sql, params, (err, result) => {
                db.detach();
                if (err) return reject(err);
                resolve(result);
            });
        });
    });
}

const getAgendamentos = async (empresa) => {
    const sql = `
        SELECT
            OS.os_id,
            os.os_dt_emissao as data_criada,
            os.os_dt_prevista as data_agendamento,
            os.os_hr_prevista as hora_do_agendamento,
            os.os_dt_entrega as data_entrega,
            os.os_hr_entrega as hora_termino,
            cliente.pes_rsocial_nome as Tutor_nome,
            e.teq_descricao as ANIMAL,
            os.os_equip_desc_1 as Nome_do_pet,
            os.os_equip_desc_2 as Idade_do_pet,
            os.os_equip_desc_3 as Raca_do_pet,
            os.os_equip_desc_4 as KG_do_pet,
            CAST(SUBSTRING(os.os_obs_defeito FROM 1 FOR 500) AS VARCHAR(500)) as diagnostico,
            tecnico.pes_rsocial_nome as tecnico_nome,
            os.os_laudo_tecnico
        FROM tb_ordem_servico OS
        left join tb_tipo_equipamento e on e.teq_id = os.os_tipo_equipamento
        left outer join tb_pessoa cliente on (os.os_cliente = cliente.pes_id)
        left outer join tb_pessoa tecnico on (os.os_tecnico = tecnico.pes_id)
        WHERE OS.OS_EMPRESA = ?
    `;

    return await queryDatabase(sql, [empresa]);
};

module.exports = {
    getAgendamentos
};
