FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends     build-essential     && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install Python dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Copy application
COPY . .
RUN uv sync --frozen --no-dev
RUN chmod +x docker-entrypoint.sh

# Reconcile the schema (create_all + stamp on a fresh DB, upgrade on a managed
# one — see docker-entrypoint.sh / src/db_bootstrap.py), then start the app.
CMD ["./docker-entrypoint.sh"]
