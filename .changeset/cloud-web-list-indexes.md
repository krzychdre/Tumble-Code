---
"tumble-code": patch
---

Improved: **Self-hosted cloud task list stays quick with many tasks.** The task list's project names, its counts and the models you can filter by, and the session quality panel of the usage metrics, are now read through database indexes instead of scanning everyone's tasks: for an account with 20,000 tasks the flat list of runs opens about twice as fast.
