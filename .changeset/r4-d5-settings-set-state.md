---
"tumble-code": patch
---

Settings components (profile manager, custom tools, settings search, LiteLLM refresh, Codex usage limits) update their state while rendering or in event handlers instead of one render late in an effect.
