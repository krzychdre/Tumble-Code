---
"tumble-code": patch
---

Internal cleanup with no visible change: each provider's settings fields are now declared once, and the older flat settings schema, the saved-profile field list and the CLI's model field are all read from that one declaration. The older openai schema now also accepts the model id that the settings screen already saves with every openai profile.
