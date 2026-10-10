---
"tumble-code": minor
---

Removed the experimental "Enable AI image generation" feature: the `generate_image` tool, its OpenRouter image model and API key settings, and its section in the Experimental settings. Attaching images to a message and reading image files work as before. A saved OpenRouter image API key is deleted from the secret storage on the next start, and the old settings and experiment flag are ignored.
