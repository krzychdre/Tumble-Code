---
"tumble-code": patch
---

Internal: the environment variables and global slots through which the CLI hosts the extension are now named and typed in one place (`@roo-code/types` `cli-runtime.ts`), and both sides read them through it. No behavior change.
