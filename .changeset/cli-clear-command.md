---
"tumble-code": patch
---

New CLI command `/clear`: starts a new task and wipes the terminal, scrollback included, so the next conversation begins on a blank screen with the welcome banner. `/new` is unchanged and still leaves the previous conversation readable above. Both now also reset the transcript promotion watermark, which had been carried over from the previous task and promoted the next task's first messages into scrollback while they were still streaming.
