---
"tumble-code": patch
---

Every literal settings default at a call site now reads the one table (`SETTINGS_DEFAULTS`), enforced by a CI check (`scripts/check-settings-defaults.mjs`); a `requestDelaySeconds` of 0 now means no retry backoff delay instead of being masked to 5 s, and `requestDelaySeconds` gained its documented default (5 s) in the table.
