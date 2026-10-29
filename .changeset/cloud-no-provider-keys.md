---
"tumble-code": patch
---

Fixed: **Provider API keys never reach the cloud.** Everything sent to the cloud (diagnostics, synced and live task messages, recorded exchanges, error reports) now has every stored provider key, custom header value and code-index key removed, also when an error message quotes it, along with passwords written into a web address and short `sk-` keys.
