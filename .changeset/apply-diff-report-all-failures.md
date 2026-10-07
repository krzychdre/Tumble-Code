---
"tumble-code": patch
---

apply_diff now tells the model about every failed block, not only the last one, and on a partial success it names the blocks that were applied so the model does not send them again.
