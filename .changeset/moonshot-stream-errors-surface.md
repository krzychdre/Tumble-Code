---
"tumble-code": patch
---

Moonshot: a rate limit (HTTP 429) or an error reported in the middle of a response now shows up as a failed request with its real reason and is retried like any other provider, instead of the turn silently ending or failing with "No output generated".
