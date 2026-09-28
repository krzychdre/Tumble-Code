---
"tumble-code": patch
---

P5 performance: one request cycle now takes a single `getState()` snapshot at cycle start and passes it to the rate-limit wait, mentions, environment details, the request generator, the system-prompt builder and the tools array — previously six to eight provider-state reads per cycle, each re-reading settings, custom modes, cloud facts and command lists. The snapshot is rebuilt after a slash-command mode switch; volatile decisions (abort flags, post-stream retry paths, asks, the post-MCP-connect prompt read) stay live.
