---
"tumble-code": patch
---

Upgrade serialize-error to 13. A tool, API request or embedder validation that fails with a thrown string or `null` still reports the same text as before, without the new "Non-error value:" prefix.
