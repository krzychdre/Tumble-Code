---
"@tumble-code/cli": patch
"tumble-code": patch
---

When the CLI is signed in to the cloud, its status line now shows the remote-control connection: `● cloud` when connected, `○ cloud connecting`, and `○ cloud offline` in the warning colour while the connection is down and being retried. The extension now reports that connection in its state.
