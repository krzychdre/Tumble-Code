---
"tumble-code": patch
---

Fixed: **Self-hosted cloud metrics stay readable whatever a client reports.** A model request reporting impossible usage (billions of tokens, a negative or astronomical cost, a model name with control characters or kilobytes long) no longer breaks an organization admin's metrics page or the upgrade: such a figure counts as zero and a name is cleaned and cut to 256 bytes.
