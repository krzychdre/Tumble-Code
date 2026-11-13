---
"tumble-code": patch
---

Fixed: **Cloud client: an ISO-8601 Retry-After no longer pauses the queue for the year as seconds.** A 429 with a date like "2026-11-12T22:32:11Z" was parsed as 2026 seconds (~34 minutes) because parseInt stopped at the first dash; both ISO-8601 and HTTP-date values now compute the actual wait-until date.
