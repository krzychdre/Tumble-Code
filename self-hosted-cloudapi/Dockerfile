# Pinned by digest so a rebuild gets the same base, not whatever the tag points
# at that day. 3.13 matches local development (uv's .venv) and the CI matrix.
# To update: `docker buildx imagetools inspect python:3.13-slim`, then replace
# the version and the digest together.
FROM python:3.14.7-slim@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends     build-essential     && rm -rf /var/lib/apt/lists/*

# Install uv (a fixed release; `latest` could change how the lock is read)
COPY --from=ghcr.io/astral-sh/uv:0.13.5@sha256:32a7bb39b496babbd997b0a39a4d66c126bdaf5661b302bf6f06abda8deca6ff /uv /usr/local/bin/uv

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
