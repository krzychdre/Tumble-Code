---
"tumble-code": patch
---

One shared backoff and countdown helper in `@roo-code/core` replaces the eight hand-rolled exponential-backoff implementations (retry handler, marketplace loader, embedders, code-index scanner/file-watcher/manager); cancelling a task now also interrupts the provider rate-limit countdown, which previously waited out the whole window.
