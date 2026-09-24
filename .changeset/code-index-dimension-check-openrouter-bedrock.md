---
"tumble-code": patch
---

Codebase indexing with the OpenRouter or Amazon Bedrock embedder now reports a wrong vector dimension right when the settings are validated, with a clear message naming the model's real dimension, instead of failing later with an unexplained "Bad Request" from Qdrant for every indexed file. The other embedders already did this.
