---
"tumble-code": patch
---

Internal: the provider settings schemas and the list of settings kept in secret storage are now generated from the per-provider config and credential tables, so adding a provider no longer means editing them by hand. Stored profiles, secrets and settings are read and written exactly as before.
