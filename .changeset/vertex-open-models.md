---
"tumble-code": patch
---

The Vertex AI model list no longer offers the open models (Llama 4 Maverick, DeepSeek R1 and V3.1, gpt-oss 120B and 20B, Qwen3 Coder, Qwen3 235B, Kimi K2 Thinking). Vertex serves them only through its OpenAI-compatible Chat Completions endpoint, while Tumble Code sent them Gemini requests that could never succeed. A profile that still has one of these ids saved keeps loading; its requests fail as they did before.
