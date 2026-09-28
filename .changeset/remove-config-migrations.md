---
"tumble-code": patch
---

Fix: importing settings no longer turns the existing provider profiles into unusable "unknown" profiles (which lost their model and made the settings fall back to defaults). Old configuration formats are no longer converted: settings files exported before this version cannot be imported, and profiles stored in a pre-v2 format are reported instead of migrated.
