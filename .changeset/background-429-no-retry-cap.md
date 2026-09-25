---
"tumble-code": patch
---

Background tasks (memory writers and parallel subagents) no longer give up on HTTP 429 (too many requests) after 7 attempts: they keep waiting and retrying (at most 10 minutes between attempts, or the delay the provider asks for) until the provider answers or the task is stopped; 429 retries do not count toward the 7-attempt limit for other errors.
