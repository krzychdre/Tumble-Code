---
"tumble-code": patch
---

When a text-only model reads an image, the note it gets now names the modes that run on an image-capable model (by their pinned API profile) and tells it to delegate the image to one of them. When no such mode exists, the note says so and tells the model not to delegate the image at all, so it no longer hands the image from one text-only mode to the next.
