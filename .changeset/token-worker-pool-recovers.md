---
"tumble-code": patch
---

Token counting keeps using its background worker after a short burst of requests fills its queue, instead of moving every later count onto the editor's main thread for the rest of the session.
