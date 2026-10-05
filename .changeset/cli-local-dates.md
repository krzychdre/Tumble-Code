---
"@tumble-code/cli": patch
---

`tumble list` and the `/export` header show local time with its offset (e.g. `2026-10-05T10:18:07+02:00`) instead of UTC. New `timeZone` in `~/.roo/cli-settings.json` sets the zone where the system has none (a container without `/etc/localtime` silently runs in UTC, and the model was then told the user is in UTC).
