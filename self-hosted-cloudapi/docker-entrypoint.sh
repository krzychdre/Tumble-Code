#!/bin/sh
# Reconcile the database schema with Alembic, then start the API.
# The reconciliation lives in db-migrate.sh so `make migrate` runs the same
# steps outside the container.
set -e

sh ./db-migrate.sh

# --timeout-graceful-shutdown: on SIGTERM (docker stop, compose down) finish
# serving the in-flight requests for up to 25 s, then exit; without it uvicorn
# waits for the connections indefinitely or kills them, depending on the
# client. Above the 10 s Docker default stop timeout: `docker stop -t 30` or
# compose `stop_grace_period` gives the sweep and engine.dispose() room.
exec uv run uvicorn src.main:app --host 0.0.0.0 --port "${PORT:-8085}" --timeout-graceful-shutdown 25
