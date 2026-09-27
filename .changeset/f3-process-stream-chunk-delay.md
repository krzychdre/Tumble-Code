---
"roo-cline": patch
---

Fix: process the current stream chunk before reading the next one in the task stream loop, so streamed text appears as it arrives instead of one chunk late. The last piece of a response no longer waits for the stream to end (or the idle timeout) before it is shown.
