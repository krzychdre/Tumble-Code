---
"tumble-code": patch
---

Fixed: **`web_fetch` can no longer reach this machine or the local network through another spelling of a name.** A trailing dot (`localhost.`) no longer gets past the check, and a public-looking name whose address is local or private (such as `127.0.0.1.nip.io`) is refused too, also after a redirect.
