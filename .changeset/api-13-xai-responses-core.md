---
"tumble-code": patch
---

xAI now reads its streamed answers the same way as OpenAI Native and Codex: tool calls stream while the model writes their arguments, and answer text that xAI sends only at the end of a response (or as a refusal) is shown instead of being dropped. Prompt-cache writes reported in the token details are counted as well.
