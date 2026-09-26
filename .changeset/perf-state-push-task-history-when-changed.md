---
"tumble-code": patch
---

Settings changes, mode switches and other actions no longer resend the whole task history to the chat view each time. The history (about 4.5 MB for 1,000 tasks) now goes along only when it changed since the view last received it, and a newly opened or reloaded view still gets it in full, so the chat panel reacts faster with a long history.
