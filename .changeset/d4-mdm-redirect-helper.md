---
"tumble-code": patch
---

Pure refactor: the MDM redirect tail shared by the `postStateToWebview*` variants is now one private helper (`postMdmRedirectToWebview`) instead of four copies. No behavior change.
