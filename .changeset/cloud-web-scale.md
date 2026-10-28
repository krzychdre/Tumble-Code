---
"tumble-code": patch
---

Improved: **Self-hosted cloud stays fast with a long history.** The usage metrics, diagnostics and task list pages now read running totals the cloud keeps as requests arrive instead of every model request and task on each view, so with 200,000 tasks and 4.4 million requests an organization's all-time metrics open in about two seconds instead of over a minute and the task list in about a tenth of a second. The upgrade prepares the history stored before it once, which takes a few minutes on a history that large.
