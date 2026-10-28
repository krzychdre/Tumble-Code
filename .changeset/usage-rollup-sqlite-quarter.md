---
"tumble-code": patch
---

Fixed: **Self-hosted cloud: usage from before the upgrade lands in the right quarter of an hour on SQLite.** When the usage summary was first built on a SQLite install, an event in the last microseconds of a quarter (for example 10:14:59.999999) was counted in the next quarter; it is now counted where ingest counts it.
