---
"tumble-code": patch
---

CLI internals: the 650-line `run()` of the terminal client is split into named steps (session flags, settings, provider configurations, limits, provider checks, the TUI run and the print run), and the provider settings of a configuration are built in one place. Messages, checks and their order are unchanged.
