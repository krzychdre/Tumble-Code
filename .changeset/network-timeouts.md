---
"tumble-code": patch
---

Stop waiting forever on a dropped connection. A model answer that goes silent for longer than the API request timeout (`apiRequestTimeout`, 10 minutes by default) now closes the request and retries like any other interrupted stream; before, it waited until you pressed Stop. Short control requests (Qwen and OpenAI Codex token refresh, the Codex usage lookup, the OpenAI-compatible model list, the OpenRouter key exchange) give up after 30 seconds, and image generation and OpenAI-compatible embedding requests now honour `apiRequestTimeout`.
