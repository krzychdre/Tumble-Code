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

# Run Alembic migrations on startup, then start the app
CMD ["sh", "-c", "uv run alembic upgrade head && uv run uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8085}"]
