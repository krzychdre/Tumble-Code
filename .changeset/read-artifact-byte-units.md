---
"tumble-code": patch
---

`read_artifact` no longer fails with "The value of "size" is out of range ... Received NaN" when a model sends `offset` or `limit` as text. Numbers in quotes ("24576") and sizes with a unit in any letter case ("24KB", "24kb", "1.5 MiB") are now read as byte counts, and a value that still is not a number gets a short error telling the model to pass a plain number.
