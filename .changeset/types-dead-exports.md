---
"tumble-code": patch
---

Internal cleanup with no visible change: about fifty unused exports were removed from the shared types package, three telemetry event names that were never sent were dropped, and the API error filtering used by telemetry now lives in the telemetry package.
