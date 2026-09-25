---
"tumble-code": patch
---

Codebase indexing now uses the Qdrant client 1.19 and undici 7 (the HTTP library the Qdrant client and the debug proxy rely on). Indexing and codebase search talk to Qdrant exactly as before; the update keeps the extension on supported, patched versions.
