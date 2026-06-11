import datetime as dt
import calendar
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from database import get_agendamento_detalhes, get_agendamentos
from middleware import validate_license


router = APIRouter(prefix="/api/agendamentos", tags=["agendamentos"], dependencies=[Depends(validate_license)])
EQUIPMENT_FIELD_COUNT = 8
RECURRENCE_LOOKAHEAD_DAYS = 370
RECURRENCE_LOOKBACK_DAYS = 90


def _parse_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _date_part(value: Any) -> dt.date | None:
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    try:
        return dt.date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _time_part(value: Any) -> dt.time | None:
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value.time().replace(tzinfo=None)
    if isinstance(value, dt.time):
        return value.replace(tzinfo=None)
    text = str(value).strip()
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return dt.datetime.strptime(text[:8], fmt).time()
        except ValueError:
            continue
    return None


def _parse_datetime(date_value: Any, time_value: Any, is_end: bool = False) -> str | None:
    date_part = _date_part(date_value)
    if not date_part:
        return None
    time_part = _time_part(time_value) or dt.time(0, 0)
    result = dt.datetime.combine(date_part, time_part)
    if is_end:
        result += dt.timedelta(minutes=30)
    return result.isoformat()


def _format_original_time(value: Any) -> str | None:
    time_part = _time_part(value)
    if not time_part:
        return None
    return f"{time_part.hour:02d}:{time_part.minute:02d}"


def _is_cliente_recorrente(value: Any) -> bool:
    text = _parse_string(value)
    if not text:
        return False
    return text.casefold() in {"sim", "s", "yes", "y", "true", "1"}


def _add_months(date_value: dt.date, months: int) -> dt.date:
    month_index = date_value.month - 1 + months
    year = date_value.year + month_index // 12
    month = month_index % 12 + 1
    last_day = calendar.monthrange(year, month)[1]
    return dt.date(year, month, min(date_value.day, last_day))


def _recurrence_window() -> tuple[dt.date, dt.date]:
    today = dt.date.today()
    return today - dt.timedelta(days=RECURRENCE_LOOKBACK_DAYS), today + dt.timedelta(days=RECURRENCE_LOOKAHEAD_DAYS)


def _equipment_descriptions(os_row: dict) -> list[str | None]:
    return [_parse_string(os_row.get(f"OS_EQUIP_DESC_{index + 1}")) for index in range(EQUIPMENT_FIELD_COUNT)]


def _equipment_labels(os_row: dict) -> list[str | None]:
    return [_parse_string(os_row.get(f"CAMPO_{index + 1}_LABEL")) for index in range(EQUIPMENT_FIELD_COUNT)]


def _map_fields_by_labels(os_row: dict) -> dict:
    descriptions = _equipment_descriptions(os_row)
    labels = _equipment_labels(os_row)
    mapped = {"customFields": []}

    for index, field_value in enumerate(descriptions):
        field_label = labels[index]
        if field_label and field_value:
            normalized = field_label.upper()
            if "IDADE" in normalized:
                mapped["idade"] = field_value
            elif "RACA" in normalized:
                mapped["raca"] = field_value
            elif "PESO" in normalized:
                mapped["peso"] = field_value
            elif "NOME" in normalized:
                mapped["nome"] = field_value

        if field_value:
            mapped["customFields"].append({
                "label": field_label or f"Campo {index + 1}",
                "value": field_value,
            })

    mapped.setdefault("idade", descriptions[1] if len(descriptions) > 1 else None)
    mapped.setdefault("raca", descriptions[2] if len(descriptions) > 2 else None)
    mapped.setdefault("peso", descriptions[3] if len(descriptions) > 3 else None)
    mapped.setdefault("nome", descriptions[0] if descriptions else None)
    return mapped


def _build_event(os_row: dict, occurrence_date: dt.date | None = None, is_recurring: bool = False) -> dict:
    descriptions = _equipment_descriptions(os_row)
    description_props = {
        f"descricao{index + 1}": value
        for index, value in enumerate(descriptions)
    }
    cliente = _parse_string(os_row.get("CLIENTE_NOME")) or "Sem Cliente"
    animal = _parse_string(os_row.get("ANIMAL")) or "Indefinido"
    field_mapping = _map_fields_by_labels(os_row)
    hora_inicio = _format_original_time(os_row.get("HORA_DO_AGENDAMENTO")) or ""
    hora_fim = _format_original_time(os_row.get("HORA_TERMINO"))
    data_inicio = occurrence_date or _date_part(os_row.get("DATA_AGENDAMENTO"))
    end_date = data_inicio if is_recurring else (_date_part(os_row.get("DATA_ENTREGA")) or data_inicio)

    if not data_inicio or not _time_part(os_row.get("HORA_DO_AGENDAMENTO")):
        return {}

    base_id = str(os_row.get("OS_ID"))
    event_id = base_id if not is_recurring else f"rec:{base_id}:{data_inicio.isoformat()}"
    custom_fields = list(field_mapping.get("customFields", []))
    cliente_recorrente = "Sim" if _is_cliente_recorrente(os_row.get("CLIENTE_RECORRENTE")) else "Nao"
    custom_fields.append({"label": "Cliente Recorrente", "value": cliente_recorrente})
    if is_recurring:
        custom_fields.append({"label": "Recorrencia", "value": "Mensal"})

    return {
        "id": event_id,
        "title": f"{animal} ({cliente})",
        "start": _parse_datetime(data_inicio, os_row.get("HORA_DO_AGENDAMENTO")),
        "end": _parse_datetime(end_date, os_row.get("HORA_TERMINO"), True),
        "extendedProps": {
            "detailId": base_id,
            "originalId": base_id,
            "recorrente": is_recurring,
            "tecnico": _parse_string(os_row.get("TECNICO_NOME")),
            **description_props,
            "equipmentDescriptions": descriptions,
            "nome": field_mapping.get("nome"),
            "raca": field_mapping.get("raca"),
            "idade": field_mapping.get("idade"),
            "peso": field_mapping.get("peso"),
            "customFields": custom_fields,
            "animal": animal,
            "cliente": cliente,
            "clienteLabel": "Cliente",
            "hora_texto": hora_inicio + (f" - {hora_fim}" if hora_fim else ""),
        },
    }


def _build_recurring_events(registros: list[dict], existing_keys: set[tuple]) -> list[dict]:
    window_start, window_end = _recurrence_window()
    recurring_events = []

    for os_row in registros:
        if not _is_cliente_recorrente(os_row.get("CLIENTE_RECORRENTE")):
            continue

        base_date = _date_part(os_row.get("DATA_AGENDAMENTO"))
        base_time = _time_part(os_row.get("HORA_DO_AGENDAMENTO"))
        cliente_id = os_row.get("OS_CLIENTE")
        if not base_date or not base_time or not cliente_id:
            continue

        month_offset = 1
        while True:
            occurrence_date = _add_months(base_date, month_offset)
            if occurrence_date > window_end:
                break
            if occurrence_date >= window_start:
                key = (cliente_id, occurrence_date.isoformat(), f"{base_time.hour:02d}:{base_time.minute:02d}")
                if key not in existing_keys:
                    event = _build_event(os_row, occurrence_date=occurrence_date, is_recurring=True)
                    if event:
                        recurring_events.append(event)
                        existing_keys.add(key)
            month_offset += 1

    return recurring_events


@router.get("")
@router.get("/")
def listar_agendamentos(empresa: int = 1):
    try:
        registros = get_agendamentos(empresa)
        formatados = []
        existing_keys = set()

        for os_row in registros:
            data_inicio = _date_part(os_row.get("DATA_AGENDAMENTO"))
            hora_inicio = _time_part(os_row.get("HORA_DO_AGENDAMENTO"))
            if not data_inicio or not hora_inicio:
                continue
            existing_keys.add((
                os_row.get("OS_CLIENTE"),
                data_inicio.isoformat(),
                f"{hora_inicio.hour:02d}:{hora_inicio.minute:02d}",
            ))
            event = _build_event(os_row)
            if event:
                formatados.append(event)

        return formatados + _build_recurring_events(registros, existing_keys)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": "Erro ao buscar agendamentos do banco de dados.", "details": str(exc)},
        ) from exc


@router.get("/{agendamento_id}")
def obter_agendamento(agendamento_id: int):
    try:
        detalhes = get_agendamento_detalhes(agendamento_id)
        if not detalhes:
            raise HTTPException(status_code=404, detail={"error": "Agendamento nao encontrado."})
        return {
            "id": str(detalhes.get("OS_ID")),
            "diagnostico": _parse_string(detalhes.get("DIAGNOSTICO")) or "Sem observacoes/diagnostico cadastrado.",
            "laudo": _parse_string(detalhes.get("LAUDO")) or "",
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": "Erro ao buscar detalhes do agendamento.", "details": str(exc)},
        ) from exc
