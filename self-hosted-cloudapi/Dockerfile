FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends     build-essential     && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY pyproject.toml poetry.lock* ./
RUN pip install --no-cache-dir poetry &&     poetry config virtualenvs.create false &&     poetry install --no-dev --no-interaction --no-ansi ||     pip install fastapi uvicorn sqlalchemy asyncpg alembic pydantic pydantic-settings python-jose httpx itsdangerous slowapi python-multipart pyyaml starlette

# Copy application
COPY . .

# Run Alembic migrations on startup, then start the app
CMD ["sh", "-c", "alembic upgrade head && uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8085}"]
