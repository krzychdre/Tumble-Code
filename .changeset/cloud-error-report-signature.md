---
"tumble-code": patch
---

Fixed: **Self-hosted cloud: one long error report can no longer stall the server.** Grouping an error report with a long run of letters and digits in its message took seconds to minutes and held every other request; it now takes a moment, and reports are grouped as before.
