---
"tumble-code": patch
---

The VS Code Language Model API provider no longer shows Claude 3.5 Sonnet (retired by GitHub Copilot on 2025-11-06) as its default model when no model is selected. It never ran it: without a selected model the extension runs the first model VS Code returns, and the settings already require a model to be selected. The built-in model facts now list only GPT-5 mini; the other families in that list (GPT-3.5, GPT-4, GPT-4o, GPT-4.1, GPT-5, o1, o3-mini, o4-mini, Claude 3.5 Sonnet, Claude Sonnet 4, Gemini 2.0 Flash, Gemini 2.5 Pro) are no longer offered by Copilot. The family setting's example is now `gpt-5-mini` instead of `gpt-4`.
