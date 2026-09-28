---
"tumble-code": patch
---

S1 refactor: extracted `WebviewStatePusher` (the `postStateToWebview*` family, the `messageAdded`/`messageUpdated` fast paths and their per-webview bookkeeping) and `TaskSlot` (the single foreground-task slot) out of `ClineProvider`, each behind a small constructor-injected host seam. No behavior change. The provider's `addClineToStack`/`removeClineFromStack` were renamed `setCurrentTask`/`clearCurrentTask`; `getCurrentTaskStack()` keeps its shape and name for the API. Plan: ai_plans/2026-09-28_s1-clineprovider-split.md.
