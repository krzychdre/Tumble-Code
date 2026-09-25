---
"tumble-code": minor
---

A model id that is not in a provider's model list is now always used as you typed it, with the capabilities and prices of the provider's default model, instead of being silently replaced by the default model (xAI, MiniMax, OpenAI, OpenAI Codex, Z.ai, Vertex, Gemini, LiteLLM and Bedrock used to do that). The API settings show a warning when the selected model id is unknown to the provider.
