---
"tumble-code": patch
---

D3 refactor: removed 33 dead one-line forwarders on Task and 4 wrapper methods on TaskApiLoop (callers now use the delegate modules directly), deduplicated the four identical `getCurrentProfileId` implementations into one shared pure function, and slimmed `TaskApiLoopAccess` to the members it actually reads. No behavior change.
