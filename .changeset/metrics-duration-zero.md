---
"tumble-code": patch
---

Fixed: **Request time reaches the cloud metrics page.** The extension and the CLI measured how long each model request took but dropped that figure before sending it, so the Duration card on the metrics page always read 0s. Requests made after updating are counted; earlier ones cannot be recovered.
