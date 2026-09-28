---
"tumble-code": patch
---

Removed old one-time settings migrations. Settings saved by versions from before 2026 are no longer upgraded on start (the old global rate limit, the single OpenAI host header, the nested image generation settings, the old condensing prompt location and the old default condensing prompt), and task histories from the Cline era (`claude_messages.json`) are no longer read. Stored settings that still carry the old migration markers keep loading as before.
