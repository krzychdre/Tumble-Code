---
"tumble-code": patch
---

Fixed: **Self-hosted cloud: hiding secrets in long texts no longer stalls the server.** Some texts, such as many blank lines or a broken private key, made secret redaction for recall and dataset exports take seconds; it now takes the same time as any other text, and recall cards are built without holding up other requests.
