---
"tumble-code": patch
---

Cloud clients now back off with equal jitter (auth/settings refresh timers, the offline retry queue, and the bridge reconnect ladder), so synchronized clients no longer retry the cloud on the same tick. The retry queue applies backoff per item: a failing request no longer drags the whole queue into its penalty window — each request retries on its own schedule (persisted across restarts). The remote-control bridge can re-arm after socket.io gives up reconnecting via the new `tumble-code.bridgeRetryDelayMs` setting (default 0 keeps the old give-up behaviour).
