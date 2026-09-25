---
"tumble-code": patch
---

The CLI's `--stdin-prompt-stream` mode no longer waits forever when stdin closes while the task it started rests on a failed API request, the mistake limit or the auto-approval request limit (for example under `--require-approval`, where nobody is left to answer). It now ends after about two seconds with a JSON error event and exit code 1. A stream whose task failed (such as an API request that cannot be retried) also exits with code 1 now instead of 0, the same as a `--print` run.
