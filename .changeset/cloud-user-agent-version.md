---
"tumble-code": patch
---

Fixed: **Cloud requests send the real extension version in the User-Agent header.** Share, bridge and recall requests sent "Tumble-Code unknown" because CloudAPI built its User-Agent without the extension context; it now receives the context at construction and every request carries the actual version.
