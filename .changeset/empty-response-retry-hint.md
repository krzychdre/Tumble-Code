---
"tumble-code": patch
---

When the model returns an empty answer (for example because the server silently dropped a call to a tool the current mode does not have), the retry now tells the model which tools it can call, instead of repeating the identical request that keeps failing.
