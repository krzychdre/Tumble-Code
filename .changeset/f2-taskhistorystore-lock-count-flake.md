---
"tumble-code": patch
---

Fix a Windows CI flake in the TaskHistoryStore spec "releases per-ID lock tails for many unique IDs": the fs.watch-triggered targeted refresh takes the same per-ID locks as upsert, so counting right after 100 upserts raced the debounced refresh pass. Added a test-only `TaskHistoryStore.waitForWatcherRefreshesForTests()` helper (fires the armed debounce and awaits the pass) and made the spec drain it before counting. No production behavior change.
