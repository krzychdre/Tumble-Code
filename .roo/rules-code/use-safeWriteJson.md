# JSON File Writing Must Be Atomic

- You MUST use `safeWriteJson(filePath: string, data: any): Promise<void>` instead of `JSON.stringify` with file-write operations
- Import it from `src/utils/safeWriteJson.ts` inside the extension (`src/`), and from `@roo-code/core` (or `@roo-code/core/fs`) in `apps/` and `packages/`; the implementation lives in `packages/core/src/fs/safeWriteJson.ts`
- `safeWriteJson` will create parent directories if necessary, so do not call `mkdir` prior to `safeWriteJson`
- `safeWriteJson` prevents data corruption via atomic writes with locking and streams the write to minimize memory footprint
- Test files are exempt from this rule
