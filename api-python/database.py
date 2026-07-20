import datetime as dt
import os
import time
from pathlib import Path
from typing import Any

from firebird_support import (
    FirebirdConfigurationError,
    clear_last_error,
    current_settings,
    open_connection,
    remember_last_error,
    write_runtime_log,
)


QUERY_TIMEOUT_SECONDS = int(os.getenv("FB_QUERY_TIMEOUT", "45"))


def _log_debug(message: str) -> None:
    write_runtime_log("agenda-debug", message)


def _validate_local_database(options: dict[str, Any]) -> None:
    host = str(options["host"]).lower()
    database = str(options["database"])
    if host in {"127.0.0.1", "localhost"} and len(database) > 2 and database[1:3] == ":\\":
        if not Path(database).exists():
            raise FirebirdConfigurationError(
                f'O banco de dados nao foi encontrado no caminho especificado: "{database}". '
                "Verifique o arquivo .env no computador do cliente.",
                diagnostics={
                    "host": options["host"],
                    "database": options["database"],
                    "connectionMode": "LOCAL_PATH",
                },
            )


def _format_failure_message(exc: Exception, elapsed: float, diagnostics: dict[str, Any] | None = None) -> str:
    details = diagnostics or {}

    if isinstance(exc, FirebirdConfigurationError):
        return str(exc)

    if elapsed >= QUERY_TIMEOUT_SECONDS:
        return (
            f"O Firebird nao respondeu em {QUERY_TIMEOUT_SECONDS} segundos na porta {details.get('port') or current_settings()['port']}. "
            "O banco pode estar muito pesado, o host pode estar incorreto ou o provider selecionado nao conseguiu concluir a conexao."
        )

    parts = [
        f"Falha ao conectar no Firebird: {exc}.",
    ]

    provider = details.get("providerSelected") or details.get("providerRequested")
    client_path = details.get("clientPath")
    process_arch = details.get("processArchitecture")
    client_arch = details.get("clientArchitecture")

    if provider:
        parts.append(f"Provider: {provider}.")
    if client_path:
        parts.append(f"DLL selecionada: {client_path}.")
    if process_arch or client_arch:
        parts.append(
            f"Arquitetura processo/DLL: {process_arch or 'desconhecida'} / {client_arch or 'desconhecida'}."
        )

    parts.append(
        "Verifique host, porta, caminho do banco, usuario/senha, charset e se a fbclient.dll escolhida e compativel com o processo."
    )
    return " ".join(parts)


def query_database(sql: str, params: list | tuple | None = None) -> list[dict]:
    params = params or []
    options = current_settings()
    _validate_local_database(options)

    _log_debug(f"Iniciando query. Host: {options['host']}, Database: {options['database']}")
    started_at = time.time()
    connection = None
    diagnostics: dict[str, Any] = {}

    try:
        connection, provider_info, diagnostics = open_connection()
        connect_duration = time.time() - started_at
        diagnostics["port"] = options["port"]
        diagnostics["host"] = options["host"]
        diagnostics["database"] = options["database"]
        diagnostics["charset"] = options["charset"]
        diagnostics["providerSelected"] = provider_info["provider"]
        _log_debug(
            f"Conectado com sucesso ao Firebird em {connect_duration:.2f}s. "
            f"Provider: {provider_info['provider']}."
        )

        cursor = connection.cursor()
        query_started_at = time.time()
        cursor.execute(sql, params)
        columns = [str(column[0]).upper() for column in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        query_duration = time.time() - query_started_at
        _log_debug(
            f"Query executada com sucesso em {query_duration:.2f}s. Registros retornados: {len(rows)}"
        )
        clear_last_error()
        return rows
    except Exception as exc:
        elapsed = time.time() - started_at
        message = _format_failure_message(exc, elapsed, diagnostics or getattr(exc, "diagnostics", None))
        remember_last_error(message, diagnostics or getattr(exc, "diagnostics", None))
        _log_debug(f"ERRO de banco apos {elapsed:.2f}s: {message}")
        raise RuntimeError(message) from exc
    finally:
        if connection is not None:
            connection.close()


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
