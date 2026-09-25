---
"tumble-code": patch
---

With auto-approve on, a task no longer retries forever when the provider answers "invalid key" (401), "forbidden" (403) or "not found" (404, for example an unknown model): these errors now stop and show the failure, so you can fix the API key, profile or model and press Retry. Other errors (including 400, rate limits and server errors) are still retried automatically as before. Declining the retry now really stops the task instead of sending the request again. In the CLI, an unattended run (print or JSON output without --require-approval) now exits with code 1 and the provider's error instead of hanging, and the interactive terminal UI offers a Retry dialog for these errors even when actions are auto-approved.
