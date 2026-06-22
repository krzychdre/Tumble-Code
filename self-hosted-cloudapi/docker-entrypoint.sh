#!/bin/sh
# Reconcile the database schema with Alembic, then start the API.
#
# The schema is defined by the ORM models (create_all), while the migration
# chain only *evolves* existing deployments. So how we bring Alembic in sync
# depends on what state the database is in — see src/db_bootstrap.py.
set -e

STATE="$(uv run python -m src.db_bootstrap)"
echo "DB state: ${STATE}"

case "${STATE}" in
  FRESH)
    # create_all already built the head schema; just record migrations as applied.
    uv run alembic stamp head
    ;;
  LEGACY)
    # Pre-Alembic database (built by an older create_all): adopt the baseline,
    # then run the evolution migrations.
    uv run alembic stamp a1b2c3d4e5f6
    uv run alembic upgrade head
    ;;
  MANAGED)
    uv run alembic upgrade head
    ;;
  *)
    echo "Unexpected DB state: '${STATE}'" >&2
    exit 1
    ;;
esac

exec uv run uvicorn src.main:app --host 0.0.0.0 --port "${PORT:-8085}"
