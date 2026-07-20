import json
import os
import shutil
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any


APP_VENDOR = "LMD Sistemas"
APP_PRODUCT = "Agenda LMD Preview"
LEGACY_APP_NAME = "Agenda LMD"
RUNTIME_CONFIG_FILENAME = "firebird-runtime.json"


def _normalized(value: str | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def data_dir() -> Path:
    explicit_dir = _normalized(os.getenv("AGENDA_DATA_DIR"))
    if explicit_dir:
        target = Path(explicit_dir)
    else:
        explicit_env = _normalized(os.getenv("AGENDA_ENV_PATH"))
        if explicit_env:
            target = Path(explicit_env).resolve().parent
        else:
            preferred_program_data = _normalized(os.getenv("PROGRAMDATA"))
            if preferred_program_data and _normalized(os.getenv("AGENDA_INSTALLED_MODE")) in {"1", "true", "TRUE"}:
                target = Path(preferred_program_data) / APP_VENDOR / APP_PRODUCT
            else:
                legacy = Path(os.getenv("APPDATA") or Path.home()) / LEGACY_APP_NAME
                modern = Path(os.getenv("LOCALAPPDATA") or os.getenv("APPDATA") or Path.home()) / APP_VENDOR / APP_PRODUCT
                target = legacy if legacy.exists() and not modern.exists() else modern

    target.mkdir(parents=True, exist_ok=True)
    return target


def logs_dir() -> Path:
    target = data_dir() / "logs"
    target.mkdir(parents=True, exist_ok=True)
    return target


def backups_dir() -> Path:
    target = data_dir() / "backups"
    target.mkdir(parents=True, exist_ok=True)
    return target


def runtime_config_path() -> Path:
    return data_dir() / RUNTIME_CONFIG_FILENAME


def _unique_paths(paths: list[Path]) -> list[Path]:
    unique: list[Path] = []
    seen: set[str] = set()

    for path in paths:
        normalized = str(path.resolve(strict=False)).lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        unique.append(path)

    return unique


def candidate_env_paths() -> list[Path]:
    explicit = _normalized(os.getenv("AGENDA_ENV_PATH"))
    paths = []
    if explicit:
        paths.append(Path(explicit))

    module_dir = Path(__file__).resolve().parent
    paths.extend([
        Path.cwd() / ".env",
        module_dir / ".env",
        module_dir.parent / "backend" / ".env",
        data_dir() / ".env",
    ])
    return _unique_paths(paths)


def existing_env_path() -> Path | None:
    for candidate in candidate_env_paths():
        if candidate.exists():
            return candidate
    return None


def preferred_env_path() -> Path:
    explicit = _normalized(os.getenv("AGENDA_ENV_PATH"))
    if explicit:
        return Path(explicit)

    current = existing_env_path()
    if current:
        return current

    return data_dir() / ".env"


def parse_env_file(path: Path | None = None) -> dict[str, str]:
    target = path or existing_env_path()
    if not target or not target.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in target.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")

    return values


def _format_env_value(value: Any) -> str:
    text = "" if value is None else str(value)
    return text.replace("\r", " ").replace("\n", " ").strip()


def _atomic_write_text(path: Path, content: str, encoding: str = "utf-8") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding=encoding, delete=False, dir=path.parent, prefix=path.name, suffix=".tmp") as handle:
        handle.write(content)
        temp_name = handle.name

    temp_path = Path(temp_name)
    os.replace(temp_path, path)


def backup_file(path: Path) -> Path | None:
    if not path.exists():
        return None

    target_dir = backups_dir()
    backup_path = target_dir / f"{path.stem}-{path.stat().st_mtime_ns}{path.suffix or '.bak'}"
    shutil.copy2(path, backup_path)
    return backup_path


def write_env_values(updates: Mapping[str, Any], path: Path | None = None, create_backup: bool = True) -> Path:
    target = path or preferred_env_path()
    target.parent.mkdir(parents=True, exist_ok=True)

    if create_backup:
        backup_file(target)

    lines = target.read_text(encoding="utf-8").splitlines() if target.exists() else []
    positions: dict[str, int] = {}

    for index, raw_line in enumerate(lines):
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#") or "=" not in raw_line:
            continue
        key = raw_line.split("=", 1)[0].strip()
        positions[key] = index

    mutable_lines = list(lines)
    for key, value in updates.items():
        rendered = f"{key}={_format_env_value(value)}"
        if key in positions:
            mutable_lines[positions[key]] = rendered
        else:
            mutable_lines.append(rendered)

    content = "\n".join(mutable_lines).rstrip() + "\n"
    _atomic_write_text(target, content)
    return target


def load_runtime_config() -> dict[str, Any]:
    path = runtime_config_path()
    if not path.exists():
        return {}

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_runtime_config(payload: Mapping[str, Any]) -> Path:
    path = runtime_config_path()
    _atomic_write_text(path, json.dumps(dict(payload), indent=2, ensure_ascii=True) + "\n")
    return path


def get_saved_firebird_settings() -> dict[str, Any]:
    config = load_runtime_config()
    firebird = config.get("firebird")
    return firebird if isinstance(firebird, dict) else {}


def save_firebird_settings(settings: Mapping[str, Any]) -> Path:
    config = load_runtime_config()
    current = config.get("firebird")
    merged = dict(current) if isinstance(current, dict) else {}
    merged.update({key: value for key, value in settings.items() if value is not None})
    config["firebird"] = merged
    return save_runtime_config(config)
