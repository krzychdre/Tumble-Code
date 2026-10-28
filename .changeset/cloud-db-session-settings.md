---
"tumble-code": patch
---

Improved: **Self-hosted cloud stays as fast on the tenth page view as on the first.** The cloud now plans every database query for the request at hand instead of settling on a one-size-fits-all plan after a few requests, which had made the task list several times slower and live messages of accounts with a long history slower to save. It also no longer compiles large metrics queries before running them, which cost about a second on an organization's usage metrics.
