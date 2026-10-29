---
"tumble-code": patch
---

Fixed: **Self-hosted cloud: an error report full of dashed words no longer stalls the server.** Grouping a report whose message was one long run of words joined by dashes took up to a second and held every other request; it now takes a moment and runs beside other requests instead of in front of them.
