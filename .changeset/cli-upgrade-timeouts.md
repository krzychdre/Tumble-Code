---
"tumble-code": patch
---

Fixed: **CLI: upgrade and installer no longer hang on a dead connection.** `tumble upgrade` gives up on the version check after 15 seconds, and the installer bounds its release lookup and checksum download, so a blackholed network ends with an error instead of waiting forever.
