---
"tumble-code": patch
---

Updated four small runtime libraries (p-limit 7, delay 7, uuid 14, os-name 7). On Linux the system prompt now names the distribution (for example "Ubuntu 24.04 LTS") instead of "Linux" and the kernel version, and on Windows desktops the OS name no longer needs a PowerShell call. A very long "write delay" setting (above about 24 days) now really waits instead of firing at once. Code index point IDs are unchanged, so existing indexes stay valid.
