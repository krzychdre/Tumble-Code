---
"tumble-code": minor
---

A provider profile has a "Max concurrent requests" field in its settings: how many requests this provider and model take at once (for example the parallel slots of a local server). It is meant to cap the subagents that run on the profile, where each subagent takes one request and the main task takes one when it runs on the same profile. Empty means no limit of its own; the global "Max parallel subagents" still applies.
