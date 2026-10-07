---
"tumble-code": patch
---

The OpenAI-compatible provider has a new profile setting, "Shorten old reasoning when the context fills up", shown under "Return reasoning to the model" and needing it. Once the context reaches the condense threshold (or the window limit), long reasoning blocks of older turns are shortened before old tool results are cut and before the conversation is condensed: each keeps its beginning, its last paragraph and every paragraph that states a finding. Only the copy sent to the model changes, the saved task keeps every block whole, and a block once shortened stays shortened the same way so the server's prompt cache keeps matching. Off by default.
