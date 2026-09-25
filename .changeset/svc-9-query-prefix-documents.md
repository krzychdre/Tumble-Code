---
"tumble-code": patch
---

Codebase indexing with nomic-embed-code (Ollama or OpenAI-compatible) now embeds your code without the search-query instruction "Represent this query for searching relevant code: ", which the model expects only on search queries. An existing nomic-embed-code index is rebuilt once, automatically, the next time indexing starts, so old and new vectors are never mixed. Other embedding models are not affected and keep their index.
