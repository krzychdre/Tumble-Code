---
"tumble-code": patch
---

Stop now closes the model request itself for every provider, so the server stops generating right away (no more billed tokens or a busy local GPU after you press Stop), and two requests running at the same time are cancelled independently.
