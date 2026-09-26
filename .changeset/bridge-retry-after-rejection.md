---
"tumble-code": patch
---

The remote-control bridge to a self-hosted cloud API now reconnects by itself after the server restarts. Before, a token that expired during the restart got the connection refused once, and the bridge stayed offline until VS Code was reloaded; now it retries after 1 s, 2 s, 4 s and so on, at most once a minute, while you are signed in.
