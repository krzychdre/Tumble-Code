---
"tumble-code": patch
---

The self-hosted cloud API takes the current minor and patch releases of its Python dependencies (FastAPI 0.161, Starlette 1.9, Pydantic 2.14 and others), the python:3.13.17-slim base image and uv 0.13.5. SQLAlchemy stays on 2.0.54 here; its 2.1 migration is a separate change.
