# Pinned by digest so a rebuild gets the same base, not whatever the tag points
# at that day. 3.13 matches local development (uv's .venv) and the CI matrix.
# To update: `docker buildx imagetools inspect python:3.13-slim`, then replace
# the version and the digest together.
FROM python:3.13.15-slim@sha256:8d9d0b8bcf6506481eae4907c18f5e3e7902e629f5f6d684f9e7c32e85e3ddf0

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends     build-essential     && rm -rf /var/lib/apt/lists/*

# Install uv (a fixed release; `latest` could change how the lock is read)
COPY --from=ghcr.io/astral-sh/uv:0.12.18@sha256:3adc3706091ce7c2fe595e669628caedd6d951551b92b258b7e7dbe06d9440bc /uv /usr/local/bin/uv

# Install Python dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Copy application
COPY . .
RUN uv sync --frozen --no-dev
RUN chmod +x docker-entrypoint.sh

# Run as an unprivileged user. It owns /app because the entrypoint's
# `uv run` may touch the project environment, and it has a home directory
# for uv's cache.
RUN useradd --create-home --uid 10001 --user-group app && chown -R app:app /app
USER app

# Reconcile the schema (create_all + stamp on a fresh DB, upgrade on a managed
# one, see db-migrate.sh and src/db_bootstrap.py), then start the app.
CMD ["./docker-entrypoint.sh"]
