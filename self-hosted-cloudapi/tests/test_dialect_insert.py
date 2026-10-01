"""dialect_insert picks the INSERT that has ON CONFLICT for the session's dialect.

The upserts in services/telemetry_service.py and services/share_service.py
depend on it; the tests run on SQLite, so the Postgres branch is pinned here.
"""

from types import SimpleNamespace

import pytest
from sqlalchemy.dialects import postgresql, sqlite

from src.database import dialect_insert


def _session(dialect: str):
    return SimpleNamespace(bind=SimpleNamespace(dialect=SimpleNamespace(name=dialect)))


@pytest.mark.parametrize("dialect,expected", [("postgresql", postgresql.insert), ("sqlite", sqlite.insert)])
def test_known_dialects_get_their_own_insert(dialect, expected):
    assert dialect_insert(_session(dialect)) is expected


def test_any_other_dialect_gets_none():
    assert dialect_insert(_session("mysql")) is None


async def test_the_test_session_is_sqlite(db_session):
    assert dialect_insert(db_session) is sqlite.insert
