---
"tumble-code": patch
---

Fixed: **CLI: upgrades and installs are verified.** `tumble upgrade` runs the installer of the exact release it installs instead of the latest development version, and the installer checks the download against the release's published checksum before unpacking it.
