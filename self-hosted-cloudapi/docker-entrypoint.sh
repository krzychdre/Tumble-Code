#!/bin/sh
# Reconcile the database schema with Alembic, then start the API.
# The reconciliation lives in db-migrate.sh so `make migrate` runs the same
# steps outside the container.
set -e

sh ./db-migrate.sh

exec uv run uvicorn src.main:app --host 0.0.0.0 --port "${PORT:-8085}"
