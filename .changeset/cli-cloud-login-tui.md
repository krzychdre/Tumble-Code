---
"tumble-code": patch
---

The interactive CLI gains `/login` and `/logout` for Tumble Code Cloud. The sign-in message accepts an optional loopback `authRedirect`, the sign-in, callback and sign-out handlers wait for the background cloud start and answer with a `cloudAuthResult` message, so the CLI can show the outcome.
