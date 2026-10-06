---
"tumble-code": patch
---

The hidden "gemini-cli" provider is now retired. It never had its own implementation, so a profile that named it silently sent its requests to Anthropic instead; such a profile now shows the "provider no longer supported" notice like other retired providers, and its saved settings are kept.

Saved profiles of providers retired earlier (Poe, Unbound, Requesty, Vercel AI Gateway, Baseten, SambaNova, Fireworks) no longer make the whole profile list fail to load: they are kept as retired profiles like the others.
