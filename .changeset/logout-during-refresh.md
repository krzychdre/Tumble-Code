---
"tumble-code": patch
---

Fixed: **Signing out of the cloud always signs you out.** A session token that was being renewed at the moment you signed out no longer keeps you signed in, and the CLI's `tumble auth cloud status` shows signed out right away.
