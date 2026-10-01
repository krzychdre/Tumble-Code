---
"@tumble-code/cli": patch
---

Removed CLI commands that could not work: `tumble auth login`, `tumble auth logout` and `tumble auth status` (their sign-in page does not exist on the self-hosted cloud) and `tumble list models` (it always printed an empty list). `tumble auth codex ...` is unchanged. The first-run screen with a single "use your own API key" choice is replaced by a one-line hint that says where to set a provider when none is configured.
