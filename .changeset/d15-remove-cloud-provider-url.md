---
"tumble-code": patch
---

Removed the `tumble-code.cloudProviderUrl` setting and the `ROO_CODE_PROVIDER_URL` environment variable. Nothing has read them since the cloud proxy provider was removed, so a value set there had no effect; if you still have it in your settings, VS Code now shows it as an unknown setting and you can delete it.
