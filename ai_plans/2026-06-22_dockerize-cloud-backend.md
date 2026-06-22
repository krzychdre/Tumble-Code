# Dockerize the self-hosted cloud backend

**Date:** 2026-06-22
**Scope:** `self-hosted-cloudapi/`

## Goal

Be able to run the self-hosted cloud API in a container.

## Finding

A `Dockerfile`, `.dockerignore`, and `docker-compose.yml` already existed and were
committed, but **the image did not build**. Proven by `docker build`:

```
OSError: Readme file does not exist: README.md
ERROR: process "/bin/sh -c uv sync --frozen --no-dev" did not complete successfully
```

### Root cause

- `pyproject.toml` declares `readme = "README.md"` under `[project]`.
- The final `RUN uv sync --frozen --no-dev` installs the project itself, so hatchling
  reads project metadata and requires `README.md` to be present.
- `.dockerignore` excluded `*.md` (and `README.md`), so the file was not in the build
  context → metadata validation fails.
- The earlier `uv sync ... --no-install-project` passes because it runs before
  `COPY . .` and does not build the project, so it never touches the README.

## Fix

One line in `.dockerignore`: keep `README.md` in the build context while still
ignoring other markdown.

```
*.md
!README.md
```

## Verification

1. `docker build -t roo-cloud-api:test .` — succeeds (was failing before).
2. `docker run ... uv run uvicorn src.main:app` — app imports cleanly through
   uvicorn and reaches Pydantic settings validation; only stops on missing required
   Authentik env vars, which `docker-compose.yml` supplies. Confirms the Python
   entrypoint, dependency set, and app module are all sound in the image.

## Notes / possible follow-ups (not done)

- Container runs as root; a non-root `USER` could be added for hardening.
- A `HEALTHCHECK` and multi-stage build (smaller runtime image) are reasonable
  future improvements but were out of scope for "make it build and run".
