---
"tumble-code": patch
---

LM Studio model listing and model loading now use version 2 of the LM Studio SDK. It needs a current LM Studio (2026 builds): with an older one the model list stays empty and an error explains what to check. When Tumble Code loads a model for you, LM Studio's own GPU settings now apply instead of an even split across all GPUs.
