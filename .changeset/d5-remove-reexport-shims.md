---
"tumble-code": patch
---

Pure refactor: the PKG-6 migration shims (`src/shared/array.ts`, `src/shared/todo.ts`, `src/shared/cost.ts`, `src/shared/context-mentions.ts`, `src/utils/safeWriteJson.ts`) are deleted; all import sites now use `@tumble-code/core/browser` / `@tumble-code/core/fs` directly. No behavior change.
