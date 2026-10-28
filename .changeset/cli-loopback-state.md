---
"tumble-code": patch
---

Fixed: **CLI: the cloud sign-in ignores a callback that arrives before the sign-in started.** The terminal's sign-in listener now accepts only the callback carrying the state of the sign-in it opened, so a request sent to its port earlier can no longer end the sign-in.
