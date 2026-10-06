---
"tumble-code": patch
---

The OpenAI-compatible provider can return the model's reasoning back to it: the new "Return reasoning to the model" profile setting keeps reasoning blocks in history and sends them as `reasoning_content` and `reasoning` on assistant messages, so reasoning models (GLM, DeepSeek R1, local vLLM) can continue their own chain of thought. `clear_thinking: false` is now tied to returning reasoning instead of the effort level, and the reasoning effort picker offers `max` in the webview and the CLI. The old "Enable R1 model parameters" toggle is removed; profiles with it enabled migrate to the new setting.
