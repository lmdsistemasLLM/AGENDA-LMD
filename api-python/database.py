import datetime as dt
import os
import time
from pathlib import Path

import fdb


DEFAULT_DATABASE = r"C:\DATAGOO CLIENTES\Clientes Firebird 3\Dados\pet\DADOS.FDB"
QUERY_TIMEOUT_SECONDS = int(os.getenv("FB_QUERY_TIMEOUT", "45"))
_FBCLIENT_LOADED = False


def _log_debug(message: str) -> None:
    try:
        log_path = Path(os.getenv("APPDATA", str(Path.home()))) / "Agenda LMD" / "agenda_debug.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        timestamp = dt.datetime.now(dt.timezone.utc).isoformat()
        log_path.write_text("", encoding="utf-8") if not log_path.exists() else None
        with log_path.open("a", encoding="utf-8") as log_file:
            log_file.write(f"[{timestamp}] {message}\n")
    except Exception as exc:
        print(f"Falha ao escrever log: {exc}")


def _load_fbclient() -> None:
    global _FBCLIENT_LOADED
    if _FBCLIENT_LOADED:
        return
    fbclient_path = os.getenv("FBCLIENT_PATH") or os.getenv("FB_CLIENT_LIBRARY")
    if not fbclient_path:
        return

    if not Path(fbclient_path).exists():
        raise RuntimeError(f"fbclient.dll nao encontrado em: {fbclient_path}")

    fdb.load_api(fbclient_path)
    _FBCLIENT_LOADED = True


def _connection_options() -> dict:
    return {
        "host": os.getenv("FB_HOST", "127.0.0.1"),
        "port": int(os.getenv("FB_PORT", "3050")),
        "database": os.getenv("FB_DATABASE", DEFAULT_DATABASE),
        "user": os.getenv("FB_USER", "SYSDBA"),
        "password": os.getenv("FB_PASSWORD", "masterkey"),
        "charset": os.getenv("FB_CHARSET", "UTF8"),
    }


def _validate_local_database(options: dict) -> None:
    host = str(options["host"]).lower()
    database = str(options["database"])
    if host in {"127.0.0.1", "localhost"} and len(database) > 2 and database[1:3] == ":\\":
        if not Path(database).exists():
            _log_debug(f"ERRO: Banco de dados nao existe no caminho: {database}")
            raise RuntimeError(
                f'O banco de dados nao foi encontrado no caminho especificado: "{database}". '
                "Verifique o arquivo .env no computador do cliente."
            )


def query_database(sql: str, params: list | tuple | None = None) -> list[dict]:
    params = params or []
    _load_fbclient()
    options = _connection_options()
    _validate_local_database(options)

    _log_debug(f"Iniciando query. Host: {options['host']}, Database: {options['database']}")
    started_at = time.time()
    con = None

    try:
        con = fdb.connect(**options)
        connect_duration = time.time() - started_at
        _log_debug(f"Conectado com sucesso ao Firebird em {connect_duration:.2f}s. Executando query...")

        cursor = con.cursor()
        query_started_at = time.time()
        cursor.execute(sql, params)
        columns = [column[0].upper() for column in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        query_duration = time.time() - query_started_at
        _log_debug(f"Query executada com sucesso em {query_duration:.2f}s. Registros retornados: {len(rows)}")
        return rows
    except Exception as exc:
        elapsed = time.time() - started_at
        if elapsed >= QUERY_TIMEOUT_SECONDS:
            message = (
                f"O Firebird nao respondeu em {QUERY_TIMEOUT_SECONDS} segundos na porta {options['port']}. "
                "O banco pode estar muito pesado ou o IP pode estar incorreto."
            )
        else:
            message = (
                f"Falha ao conectar no Firebird: {exc}. "
                "Verifique se o servico do Firebird esta rodando e se a senha/usuario estao corretos."
            )
        _log_debug(f"ERRO de banco apos {elapsed:.2f}s: {exc}")
        raise RuntimeError(message) from exc
    finally:
        if con is not None:
            con.close()


def _relation_fields(relation_name: str) -> set[str]:
    sql = """
        SELECT TRIM(rf.rdb$field_name) AS field_name
        FROM rdb$relation_fields rf
        WHERE rf.rdb$relation_name = ?
    """
    rows = query_database(sql, [relation_name.upper()])
    return {str(row.get("FIELD_NAME", "")).upper() for row in rows}


def _cliente_recorrente_select() -> str:
    configured = os.getenv("CLIENTE_RECORRENTE_FIELD")
    try:
        fields = _relation_fields("TB_PESSOA")
    except Exception as exc:
        _log_debug(f"Nao foi possivel consultar campos de TB_PESSOA: {exc}")
        fields = set()

    candidates = [
        configured,
        "PES_CLIENTE_RECORRENTE",
        "CLIENTE_RECORRENTE",
        "PES_RECURRENTE",
        "PES_RECORRENTE",
        "PES_CAMPO_CLIENTE_RECORRENTE",
    ]

    for field_name in candidates:
        normalized = str(field_name or "").strip().upper()
        if normalized and normalized in fields:
            return f"cliente.{normalized}"

    _log_debug(
        "Campo Cliente Recorrente nao localizado em TB_PESSOA. "
        "Configure CLIENTE_RECORRENTE_FIELD no .env com o nome do campo customizado do retaguarda."
    )
    return "CAST(NULL AS VARCHAR(20))"


def get_agendamentos(empresa: int) -> list[dict]:
    cliente_recorrente_select = _cliente_recorrente_select()
    sql = """
        SELECT
            OS.os_id,
            OS.data_criada,
            OS.data_agendamento,
            OS.hora_do_agendamento,
            OS.data_entrega,
            OS.hora_termino,
            OS.os_cliente,
            cliente.pes_rsocial_nome AS CLIENTE_NOME,
            {cliente_recorrente_select} AS CLIENTE_RECORRENTE,
            e.teq_descricao AS ANIMAL,
            OS.os_equip_desc_1 AS OS_EQUIP_DESC_1,
            OS.os_equip_desc_2 AS OS_EQUIP_DESC_2,
            OS.os_equip_desc_3 AS OS_EQUIP_DESC_3,
            OS.os_equip_desc_4 AS OS_EQUIP_DESC_4,
            OS.os_equip_desc_5 AS OS_EQUIP_DESC_5,
            OS.os_equip_desc_6 AS OS_EQUIP_DESC_6,
            OS.os_equip_desc_7 AS OS_EQUIP_DESC_7,
            OS.os_equip_desc_8 AS OS_EQUIP_DESC_8,
            e.teq_campo_1 AS CAMPO_1_LABEL,
            e.teq_campo_2 AS CAMPO_2_LABEL,
            e.teq_campo_3 AS CAMPO_3_LABEL,
            e.teq_campo_4 AS CAMPO_4_LABEL,
            e.teq_campo_5 AS CAMPO_5_LABEL,
            e.teq_campo_6 AS CAMPO_6_LABEL,
            e.teq_campo_7 AS CAMPO_7_LABEL,
            e.teq_campo_8 AS CAMPO_8_LABEL,
            tecnico.pes_rsocial_nome AS TECNICO_NOME
        FROM (
            SELECT
                os_id,
                os_dt_emissao AS data_criada,
                os_dt_prevista AS data_agendamento,
                os_hr_prevista AS hora_do_agendamento,
                os_dt_entrega AS data_entrega,
                os_hr_entrega AS hora_termino,
                os_cliente,
                os_tecnico,
                os_tipo_equipamento,
                os_equip_desc_1,
                os_equip_desc_2,
                os_equip_desc_3,
                os_equip_desc_4,
                os_equip_desc_5,
                os_equip_desc_6,
                os_equip_desc_7,
                os_equip_desc_8
            FROM tb_ordem_servico
            WHERE OS_EMPRESA = ?
              AND os_id > (
                  SELECT COALESCE(MAX(os_id), 0) - 25000
                  FROM tb_ordem_servico
              )
              AND os_dt_prevista >= CURRENT_DATE - 90
              AND os_dt_prevista IS NOT NULL
              AND os_hr_prevista IS NOT NULL
        ) OS
        LEFT JOIN tb_tipo_equipamento e
            ON e.teq_id = OS.os_tipo_equipamento
        LEFT JOIN tb_pessoa cliente
            ON OS.os_cliente = cliente.pes_id
        LEFT JOIN tb_pessoa tecnico
            ON OS.os_tecnico = tecnico.pes_id
    """.format(cliente_recorrente_select=cliente_recorrente_select)
    return query_database(sql, [empresa])


def get_agendamento_detalhes(agendamento_id: int) -> dict | None:
    sql = """
        SELECT
            os_id,
            CAST(SUBSTRING(os_obs_defeito FROM 1 FOR 4000) AS VARCHAR(4000)) as diagnostico,
            CAST(SUBSTRING(os_laudo_tecnico FROM 1 FOR 4000) AS VARCHAR(4000)) as laudo
        FROM tb_ordem_servico
        WHERE os_id = ?
    """
    result = query_database(sql, [agendamento_id])
    return result[0] if result else None
