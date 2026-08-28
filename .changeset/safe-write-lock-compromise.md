---
"tumble-code": patch
---

- Stopped a lost inter-process write lock (reported by proper-lockfile as "compromised", which can happen on slow or remote filesystems) from crashing the extension host with an uncaught exception. The affected write operation now fails with a visible error instead, even when the write itself completed, because a compromised lock means another process may have written concurrently.
