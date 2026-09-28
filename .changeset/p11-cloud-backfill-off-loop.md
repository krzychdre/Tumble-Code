---
"self-hosted-cloudapi": patch
---

Cloud API: a task backfill builds its message rows in a worker thread and writes them with one bulk insert, so a large shared conversation no longer stalls the server for other requests. The live bridge now writes a streaming message at most every 250 ms instead of committing every chunk; finished messages are still saved immediately, and held revisions are saved on disconnect and shutdown.
