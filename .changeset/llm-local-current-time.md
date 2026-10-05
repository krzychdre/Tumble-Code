---
"tumble-code": patch
---

The model now gets the local wall-clock time, the same moment in UTC and the UTC bounds of the local day, instead of only a UTC timestamp plus an offset. A model asked about "today" no longer takes the UTC date for it (e.g. losing everything between local midnight and 02:00 in Warsaw).
