---
"tumble-code": patch
---

Faster task-history lookups (cancelling, reopening and cost totals no longer parse the whole conversation file) and fewer secret-storage reads and OpenAI Codex token refreshes on every UI state update; also removes dead message handlers and the settings migration that was scheduled for removal in September 2025.
