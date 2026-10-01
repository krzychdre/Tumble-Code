"""docker-compose.yml must not hold defaults of its own for the api.

config/settings.py is the one place for the api's defaults. The compose file
used to repeat about two dozen of them and had drifted: it turned the bridge
off (BRIDGE_ENABLED=false) while settings.py, .env.example and the docs all
said on. These tests read the api service's environment the way Compose
resolves it and load Settings from the result.
"""

import re
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from config.settings import Settings

ROOT = Path(__file__).resolve().parent.parent

# The values the compose stack decides itself, not copies of a settings.py
# default: its own Postgres and the in-network Authentik address.
COMPOSE_OWNED = {"DATABASE_URL", "AUTHENTIK_INTERNAL_URL"}

STRONG_SECRET = "x" * 20 + "0123456789abcdef"

_INTERPOLATION = re.compile(r"^\$\{(?P<name>\w+)(?:(?P<op>:-|:\?)(?P<arg>.*))?\}$")


def _is_required_by_compose(value) -> bool:
    match = _INTERPOLATION.match(str(value)) if value is not None else None
    return bool(match and match["op"] == ":?")


def _api_environment() -> dict:
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text())
    return compose["services"]["api"]["environment"]


def _resolve(environment: dict, dotenv: dict) -> dict:
    """The container environment Compose builds from ``environment`` when the
    shell and .env hold ``dotenv``. A bare name is passed through only when
    set; ``${VAR:-x}`` falls back to x; ``${VAR:?msg}`` refuses to start."""
    resolved = {}
    for key, value in environment.items():
        if value is None:
            if key in dotenv:
                resolved[key] = dotenv[key]
            continue
        match = _INTERPOLATION.match(str(value))
        if not match:
            resolved[key] = str(value)
            continue
        name, op, arg = match["name"], match["op"], match["arg"]
        if dotenv.get(name):
            resolved[key] = dotenv[name]
        elif op == ":-":
            resolved[key] = arg
        elif op == ":?":
            raise RuntimeError(f"compose refuses to start: {arg}")
        else:
            resolved[key] = ""
    return resolved


def _settings_from(container_env: dict, monkeypatch) -> Settings:
    # Start from nothing: conftest.py exports test values for several fields.
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    for key, value in container_env.items():
        monkeypatch.setenv(key, value)
    return Settings()


def test_every_compose_variable_is_a_setting():
    fields = {name.upper() for name in Settings.model_fields}
    assert set(_api_environment()) - fields == set()


def test_compose_gives_no_default_where_settings_py_has_one():
    """A value written in compose for a field that has a settings.py default
    is a second copy of that default, the thing that drifted."""
    for key, value in _api_environment().items():
        field = Settings.model_fields[key.lower()]
        if key in COMPOSE_OWNED or field.is_required() or _is_required_by_compose(value):
            continue
        assert value is None, f"{key} has a compose default ({value!r}); pass it by name instead"


def test_bundled_stack_gets_the_settings_py_defaults(monkeypatch):
    env = _resolve(_api_environment(), {"SECRET_KEY": STRONG_SECRET, "JWT_SECRET": STRONG_SECRET})
    loaded = _settings_from(env, monkeypatch)

    assert loaded.bridge_enabled is True
    environment = _api_environment()
    for name, field in Settings.model_fields.items():
        key = name.upper()
        if key in COMPOSE_OWNED or field.is_required() or _is_required_by_compose(environment.get(key)):
            continue
        assert getattr(loaded, name) == field.default, name


def test_dotenv_values_still_reach_the_api(monkeypatch):
    env = _resolve(
        _api_environment(),
        {
            "SECRET_KEY": STRONG_SECRET,
            "JWT_SECRET": STRONG_SECRET,
            "BRIDGE_ENABLED": "false",
            "PORT": "9090",
            "WEB_PUBLIC_URL": "http://192.168.50.141:8085",
        },
    )
    loaded = _settings_from(env, monkeypatch)

    assert loaded.bridge_enabled is False
    assert loaded.port == 9090
    assert loaded.web_public_url == "http://192.168.50.141:8085"


@pytest.mark.parametrize("missing", ["SECRET_KEY", "JWT_SECRET"])
def test_compose_refuses_to_start_without_a_secret(missing):
    dotenv = {"SECRET_KEY": STRONG_SECRET, "JWT_SECRET": STRONG_SECRET}
    del dotenv[missing]
    with pytest.raises(RuntimeError, match=missing):
        _resolve(_api_environment(), dotenv)


def test_an_empty_string_does_not_mean_unset(monkeypatch):
    """Why the compose file passes names instead of ``${VAR:-}``: an empty
    string is a value to pydantic-settings, and not a valid boolean."""
    env = _resolve(_api_environment(), {"SECRET_KEY": STRONG_SECRET, "JWT_SECRET": STRONG_SECRET})
    env["BRIDGE_ENABLED"] = ""
    with pytest.raises(ValidationError):
        _settings_from(env, monkeypatch)
