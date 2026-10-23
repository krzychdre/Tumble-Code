---
"tumble-code": patch
---

The self-hosted cloud API runs on SQLAlchemy 2.1.6. It now asks for the `asyncio` extra explicitly, because SQLAlchemy 2.1 no longer installs greenlet (needed by the async engine) on its own.
