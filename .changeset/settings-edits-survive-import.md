---
"tumble-code": patch
---

Fix unsaved changes in Settings being thrown away after a settings import: once settings had been imported, any later update from the extension (for example a task message) reset the form. Now only a new import resets it.
