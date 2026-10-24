---
"tumble-code": patch
---

An unreachable provider no longer leaves the CLI silent: print mode writes each automatic retry to stderr (the error with the host and the socket reason, and the seconds to the next attempt), the TUI shows the same line, and a print run that auto-approves gives up and exits 1 after the 7 attempts a background task gets. Network errors from every provider now name the endpoint and the reason, for example `Connection error. (connect ECONNREFUSED 127.0.0.1:8080)`.
