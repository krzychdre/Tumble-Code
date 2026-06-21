#!/usr/bin/env bash
set -euo pipefail

# Self-Hosted Roo Code Cloud API - run script
# Uses uv (https://docs.astral.sh/uv/) for dependency management

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$SCRIPT_DIR/self-hosted-cloudapi"
cd "$API_DIR"

# Load env file if present
if [ -f "$API_DIR/.env" ]; then
    set -a
    source "$API_DIR/.env"
    set +a
    echo "Loaded env file"
else
    echo "WARNING: .env file not found - copy $API_DIR/.env.example and fill in the values"
    exit 1
fi

# Defaults
: "${PORT:=8085}"
: "${HOST:=0.0.0.0}"

# Ensure uv is available
if ! command -v uv &>/dev/null; then
    echo "ERROR: uv is not installed. Install it: https://docs.astral.sh/uv/getting-started/installation/"
    exit 1
fi

echo "Installing / syncing dependencies with uv ..."
uv sync

# Run Alembic migrations
echo "Running database migrations ..."
uv run alembic upgrade head

# Start the API server
echo "Starting Roo Cloud API on ${HOST}:${PORT}"
uv run uvicorn src.main:app --host "${HOST}" --port "${PORT}" --reload
