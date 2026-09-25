---
"tumble-code": patch
---

Exporting settings and previewing the system prompt no longer create a provider connection just to read the model details (an OpenRouter profile used to start downloading its model list), and a VS Code Language Model provider that is replaced by a mode or profile switch stops listening for configuration changes instead of lingering until the window closes.
