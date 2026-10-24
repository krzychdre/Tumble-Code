---
"tumble-code": patch
---

The optional development `.env` is now read with Node's built-in `process.loadEnvFile`, and the e2e runner and pre-push hook use `node --env-file-if-exists`; the `@dotenvx/dotenvx` dependency is gone.
