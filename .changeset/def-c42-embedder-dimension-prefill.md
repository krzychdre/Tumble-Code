---
"tumble-code": patch
---

The code-index settings no longer pre-fill the embedding dimension with 1536. Saving the settings used to store that number even when you never entered it, so an Ollama or OpenAI-compatible model with another dimension ended in a Qdrant "Bad Request"; the field now stays empty (with its placeholder) until you fill it in. If an earlier save already stored 1536 for such a model, correct the dimension once.
