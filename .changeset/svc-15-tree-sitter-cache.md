---
"tumble-code": patch
---

Listing code definitions and indexing code no longer reload the language grammar for every file and no longer leak parser memory: each grammar is loaded once and reused, parse trees are freed after use, and everything is released when the extension shuts down.
