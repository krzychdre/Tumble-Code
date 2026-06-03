# Zoo-222 Port Plan: ReadFileTool Comprehensive Coverage + Legacy Failure Flag

## §0 Context & Credit

Ported from Zoo-Code PR #222, upstream commit `f1f7cb457`.
Author: Armando Vaquera <proyectoaura.org@gmail.com>
Trailer: `Co-authored-by: Armando Vaquera <263793884+proyectoauraorg@users.noreply.github.com>`

## §1 What It Does

1. **Drop debug console.warn** — removes the temporary `[read_file] Legacy format detected` warn from `executeLegacy`.
2. **Mirror native failure flag in legacy path** — sets `task.didToolFailInCurrentTurn = true` on three error branches in `executeLegacy`: rooignore block, directory read, and file read error (catch block). The native path already sets this flag; the legacy path was missing it.
3. **Broaden `isLegacyReadFileParams`** — also recognize bare-`files` calls persisted before the `_legacyFormat` flag was introduced (re-hydrated history). The guard now checks `hasLegacyFlag || hasFilesArray`.
4. **Comprehensive test suite** — 756 lines of new test coverage in `readFileTool.spec.ts` covering input validation, rooignore blocking, directory/binary/image handling, image memory limits, approval flow, slice & indentation modes, output structure, and the legacy multi-file format.

## §2 Scope Cuts / Landmines

- No TTS/router/cloud changes. No Roo-branding changes (internal ID stays `Roo-Code`).
- No "Zoo" strings introduced in tests.
- The legacy format `executeLegacy` read path reads files with `fs.readFile(path, "utf8")` (returning a string), while the native path uses `fs.readFile(path)` (Buffer). Tests mock accordingly.
- The existing test file (783 lines) already has a basic test skeleton. The upstream version (1489 lines) adds many new describe blocks. We replace the file wholesale with the upstream version.

## §3 Exact Edits

### 3.1 `packages/types/src/tool-params.ts` — broaden type guard

Before:

```ts
export function isLegacyReadFileParams(params: ReadFileToolParams): params is LegacyReadFileParams {
	return "_legacyFormat" in params && params._legacyFormat === true
}
```

After:

```ts
export function isLegacyReadFileParams(params: ReadFileToolParams): params is LegacyReadFileParams {
	// `NativeToolCallParser` always tags freshly parsed legacy calls with `_legacyFormat: true`.
	// The bare-`files` fallback only matters for chat history persisted before that flag was
	// introduced (commit cc86049f1) and re-hydrated on a later run. Note that params matched via
	// that fallback narrow to `LegacyReadFileParams` but leave `_legacyFormat` `undefined`, so
	// callers should branch on the presence of `files`, not on `_legacyFormat === true`.
	const hasLegacyFlag = "_legacyFormat" in params && params._legacyFormat === true
	const hasFilesArray = "files" in params && Array.isArray((params as unknown as Record<string, unknown>).files)
	return hasLegacyFlag || hasFilesArray
}
```

### 3.2 `src/core/tools/ReadFileTool.ts` — drop debug warn + set failure flags

**a) Drop the console.warn (lines ~677-678):**

```ts
// DELETE:
// Temporary indicator for testing legacy format detection
console.warn("[read_file] Legacy format detected - using backward compatibility path")
```

**b) Rooignore branch (after `results.push(...)`, before `continue`):**

```ts
// ADD:
// Mirror the native path: a blocked file marks the tool turn as failed.
task.didToolFailInCurrentTurn = true
```

**c) Directory branch (after `await task.say("error", ...)`, before `continue`):**

```ts
// ADD:
// Mirror the native path: a failed read marks the tool turn as failed.
task.didToolFailInCurrentTurn = true
```

**d) Read-error catch block (after `await task.say("error", ...)`):**

```ts
// ADD:
// Mirror the native path: a failed read marks the tool turn as failed.
task.didToolFailInCurrentTurn = true
```

## §4 TDD Note + Verification Commands

TDD proof: run the legacy failure-flag tests BEFORE applying production changes to confirm RED:

```
cd src && npx vitest run core/tools/__tests__/readFileTool.spec.ts -t "legacy"
```

After applying all changes, confirm GREEN:

```
cd src && npx vitest run core/tools/__tests__/readFileTool.spec.ts
```

Type check:

```
pnpm check-types
```

Lint:

```
cd src && pnpm lint
```

## §5 Binary Acceptance

All 3 production files changed, no binary assets involved.
