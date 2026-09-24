#!/bin/sh
# Bring the database schema up to date. Used by docker-entrypoint.sh on every
# container start and by `make migrate` for a local (non-Docker) setup, so
# both take the same path.
#
# The schema is defined by the ORM models (create_all), while the migration
# chain only *evolves* existing deployments: the baseline revision is a no-op
# and the next one alters columns of tables it never creates. That is why a
# plain `alembic upgrade head` fails on an empty database. How we bring Alembic
# in sync depends on what state the database is in, see src/db_bootstrap.py.
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
