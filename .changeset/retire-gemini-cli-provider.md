---
"tumble-code": patch
"@tumble-code/cli": patch
---

The hidden "gemini-cli" provider is now retired. It never had its own implementation, so a profile that named it silently sent its requests to Anthropic instead; such a profile now shows the "provider no longer supported" notice like other retired providers, and its saved settings are kept.
