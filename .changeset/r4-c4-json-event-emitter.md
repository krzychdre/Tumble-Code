---
"tumble-code": patch
---

CLI internals: the JSON and stream-json emitter builds tool-use events from one table per tool kind and shares one delta helper and one "skip an empty streamed update" path. The output formats are byte-for-byte unchanged.
