---
"tumble-code": patch
---

Codebase indexing: every embedding provider now behaves the same way. An oversized code chunk is shortened instead of silently dropped (dropping it paired the following chunks with the wrong vectors), Ollama requests are split into batches and retried on rate limits like the others, a rate limit at one provider no longer slows down a different endpoint, and a failed request is reported once instead of up to four times.
