---
"tumble-code": patch
---

A Qdrant URL typed without a scheme whose host name starts with "http" (for example `httpbin.org:8080`) now connects to that host and port over http. Before, it was read as a URL with the scheme "httpbin:" and no host, so indexing could not reach the server.
