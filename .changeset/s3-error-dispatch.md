---
"tumble-code": patch
---

S3 refactor: moved the API error dispatch (`handleApiRequestError`, the fail-fast and capped-retry decisions, and the background-task failure recording) from TaskApiLoop into RetryHandler, which now owns every error→retry decision. TaskApiLoop keeps only the loop presentation (ask, backoff call site, stack requeue). No behavior change.
