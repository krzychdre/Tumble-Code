---
"@tumble-code/cli": patch
---

The CLI no longer ships the unused cloud SDK client or its `@trpc/client` and `superjson` dependencies, and no longer reads the `ROO_SDK_BASE_URL` environment variable, which nothing used. No behavior change.
