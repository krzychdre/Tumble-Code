---
"tumble-code": patch
---

Improved: **Self-hosted cloud metrics stay fast for large organizations.** The cloud now adds every model request into running totals per task and quarter of an hour as it arrives, so the usage metrics and diagnostics pages add up those totals instead of every request of the period: an organization's all-time metrics page with millions of requests opens in about two seconds instead of twenty. The upgrade builds the totals from the requests stored before it, once.
