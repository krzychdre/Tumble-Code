---
"tumble-code": patch
---

Fixed: **Your cloud sign-in token is no longer saved with requests waiting to be retried.** Requests that failed and wait for another try are stored without the token, a retry signs them with the current one, a token saved by an earlier version is removed, signing out always empties the waiting list, and the CLI keeps its state files readable by you only.
