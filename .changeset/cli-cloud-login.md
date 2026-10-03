---
"tumble-code": patch
---

The CLI can sign in to a Tumble Code Cloud: `tumble auth cloud login`, `logout` and `status`, with the cloud named by `cloudApiUrl` in `~/.roo/cli-settings.json`. The browser returns to a one-shot listener on 127.0.0.1 (or the user pastes the address it ended on, from a remote shell), and a signed-in CLI run sends the same telemetry as the extension. The extension gains a cloud-auth-only activation for this and accepts a loopback address as the sign-in redirect.
