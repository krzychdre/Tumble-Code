---
"tumble-code": patch
---

Fixed: **Clear errors from Z.ai and Moonshot.** A refused or failed request now names the provider and the cause, for example `Connection error. (connect ECONNREFUSED 127.0.0.1:8080)`, instead of a bare "Connection error.".
