---
"tumble-code": patch
---

Fixed: **Self-hosted cloud: the request rate limit now applies.** `RATE_LIMIT_REQUESTS_PER_MINUTE` limits every page and API route per client address and route, as documented; before, it only applied to the health check. The extension's own event, image and LLM-exchange uploads stay outside it.
