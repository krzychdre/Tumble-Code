---
"tumble-code": patch
---

Fixed: **CLI: web_fetch connects to the address it checked.** In the CLI, `web_fetch` now connects to the public address it verified instead of looking the name up a second time, so a hostile DNS server can no longer switch the request to your own machine or local network between the check and the request.
