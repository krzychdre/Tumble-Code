---
"self-hosted-cloudapi": patch
---

Cloud API readiness and shutdown hygiene: new `/health/ready` endpoint (SELECT 1 on the database, 503 when down) with a matching Docker compose healthcheck, `pool_pre_ping` on the DB engine, explicit timeouts on the Authentik httpx back channel, a uvicorn graceful-shutdown timeout (25 s) in the container entrypoint, and socket.io closed on app shutdown. `/health` stays liveness-only (no DB).
