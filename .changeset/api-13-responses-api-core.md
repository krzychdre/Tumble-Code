---
"tumble-code": patch
---

OpenAI Codex now reports the prompt-cache writes of GPT-5.6 models in the token counts, like OpenAI Native already did. OpenAI Native and Codex now read the Responses API through one shared implementation, so both show the same text for the same answer: the rarely used plain-HTTP fallback no longer shows a text twice or shows tool status events as answer text, and an OpenAI Native error that gives its reason in a "detail" field shows that reason instead of raw JSON.
