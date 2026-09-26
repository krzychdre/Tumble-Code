"""The marketplace YAML is parsed once per file version, not per request (CAPI-M12).

GET /api/marketplace/modes and /mcps used to open and ``yaml.safe_load`` their
file on every request, through two copies of the same loader. There is now one
loader with a cache keyed on the file's modification time and size: requests
between edits reuse the parsed items, and an edit shows up on the next request
without a restart.
"""

import os
from pathlib import Path

import pytest
import yaml

from config.settings import settings
from src.services import marketplace_service
from src.services.marketplace_service import load_mcps_from_yaml, load_modes_from_yaml

SHIPPED = Path(__file__).resolve().parent.parent / "config" / "marketplace"


def _mode(i: int) -> dict:
    return {"id": f"mode-{i}", "name": f"Mode {i}", "type": "mode", "content": f"# Mode {i}"}


def _mcp(i: int) -> dict:
    return {"id": f"mcp-{i}", "name": f"Mcp {i}", "type": "mcp", "url": f"https://example.com/{i}"}


def _write(path: Path, items: list[dict], mtime_ns: int) -> None:
    path.write_text(yaml.safe_dump(items))
    os.utime(path, ns=(mtime_ns, mtime_ns))


@pytest.fixture
def yaml_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "marketplace_source", "yaml")
    monkeypatch.setattr(settings, "marketplace_yaml_dir", str(tmp_path))
    return tmp_path


@pytest.fixture
def parses(monkeypatch):
    """Count the YAML parses the service performs."""
    calls = []
    real = yaml.safe_load

    def _counting(stream):
        calls.append(stream)
        return real(stream)

    monkeypatch.setattr(marketplace_service.yaml, "safe_load", _counting)
    return calls


def test_repeated_reads_parse_the_file_once(yaml_dir, parses):
    _write(yaml_dir / "modes.yaml", [_mode(1), _mode(2)], 1_000_000_000_000_000_000)

    first = load_modes_from_yaml()
    second = load_modes_from_yaml()

    assert [m.id for m in first] == ["mode-1", "mode-2"]
    assert [m.id for m in second] == ["mode-1", "mode-2"]
    assert len(parses) == 1


def test_an_edit_is_picked_up_without_a_restart(yaml_dir, parses):
    path = yaml_dir / "modes.yaml"
    _write(path, [_mode(1)], 1_000_000_000_000_000_000)
    assert [m.id for m in load_modes_from_yaml()] == ["mode-1"]

    # Same size on purpose: only the modification time says the file changed.
    _write(path, [_mode(2)], 1_000_000_001_000_000_000)
    assert [m.id for m in load_modes_from_yaml()] == ["mode-2"]
    assert len(parses) == 2

    assert [m.id for m in load_modes_from_yaml()] == ["mode-2"]
    assert len(parses) == 2


def test_modes_and_mcps_are_cached_separately(yaml_dir, parses):
    _write(yaml_dir / "modes.yaml", [_mode(1)], 1_000_000_000_000_000_000)
    _write(yaml_dir / "mcps.yaml", [_mcp(1), _mcp(2)], 1_000_000_000_000_000_000)

    for _ in range(3):
        assert [m.id for m in load_modes_from_yaml()] == ["mode-1"]
        assert [m.id for m in load_mcps_from_yaml()] == ["mcp-1", "mcp-2"]
    assert len(parses) == 2


def test_a_removed_file_reads_as_empty(yaml_dir):
    path = yaml_dir / "mcps.yaml"
    _write(path, [_mcp(1)], 1_000_000_000_000_000_000)
    assert len(load_mcps_from_yaml()) == 1

    path.unlink()
    assert load_mcps_from_yaml() == []


def test_an_empty_file_reads_as_empty(yaml_dir):
    (yaml_dir / "modes.yaml").write_text("# nothing here\n")
    assert load_modes_from_yaml() == []


def test_a_non_yaml_source_reads_nothing(yaml_dir, monkeypatch, parses):
    _write(yaml_dir / "modes.yaml", [_mode(1)], 1_000_000_000_000_000_000)
    monkeypatch.setattr(settings, "marketplace_source", "database")
    assert load_modes_from_yaml() == []
    assert parses == []


def test_a_caller_cannot_change_the_cached_list(yaml_dir):
    _write(yaml_dir / "modes.yaml", [_mode(1)], 1_000_000_000_000_000_000)
    load_modes_from_yaml().clear()
    assert [m.id for m in load_modes_from_yaml()] == ["mode-1"]


def test_the_endpoints_serve_the_shipped_files(client, monkeypatch):
    monkeypatch.setattr(settings, "marketplace_source", "yaml")
    monkeypatch.setattr(settings, "marketplace_yaml_dir", str(SHIPPED))
    shipped_modes = yaml.safe_load((SHIPPED / "modes.yaml").read_text())
    shipped_mcps = yaml.safe_load((SHIPPED / "mcps.yaml").read_text())

    modes = client.get("/api/marketplace/modes")
    mcps = client.get("/api/marketplace/mcps")

    assert modes.status_code == 200
    assert [m["id"] for m in modes.json()["modes"]] == [m["id"] for m in shipped_modes]
    assert mcps.status_code == 200
    assert [m["id"] for m in mcps.json()["mcps"]] == [m["id"] for m in shipped_mcps]
