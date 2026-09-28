---
"tumble-code": patch
---

D7 refactor: replaced the `clineStack` array in ClineProvider with a single `currentTask` slot — every production path already removed the current task before adding another, so the array never held more than one entry. `rootTask` for delegated children is now derived from the parent chain and `taskNumber` for fresh tasks is the constant the old `length + 1` read always produced. No behavior change.
