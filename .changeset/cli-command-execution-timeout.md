---
"tumble-code": patch
---

The CLI's limit on how long a shell command may run is now configurable. It was fixed at 300 seconds, so a longer job (a build, a scraper) was always stopped with "Command execution timed out after 300 seconds" and the model was told not to run it again. Set `"commandExecutionTimeout": 1800` in `~/.roo/cli-settings.json` or pass `--command-execution-timeout 1800` for one run; `0` means no limit. The default stays 300. A value that is not a whole number of seconds (such as `"10m"`) stops the run at startup instead of silently removing the limit.
