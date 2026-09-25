---
"tumble-code": patch
---

Provider errors now keep their HTTP status on every provider (LM Studio, LiteLLM, Ollama, Mistral, Gemini, Bedrock, Anthropic on Vertex, OpenAI native and Codex among them), so a background model that is rate limited (429), rejects the request (400) or has bad credentials (401) falls back to the task's own model. The OpenAI provider no longer shows "OpenAI completion error:" twice in one message.
