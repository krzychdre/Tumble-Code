# WP-P6: Check the custom storage path once, not on every task file access

Status: ready
Effort: S      Risk: low      Depends on: none
Branch name: fix/p6-memoize-storage-base-path      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

`getTaskDirectoryPath` (`src/utils/storage.ts`) is called on every read and save of a task's files. Through
`getStorageBasePath` it reads the `customStoragePath` setting and, when one is set, runs `mkdir` and `access` on that
folder every time, and shows an error toast every time the folder is unusable. Remember the result of that check per
(default path, configured custom path), so it runs once per setting value, and share it between parallel callers.

## 2. Why it matters (user-visible effect, 2-4 sentences)

Users with a custom storage path (often on a network or synced drive, where each file system call is slow) pay two
extra file system round trips on every message save, history read, artifact write and command-output write. When the
folder is unusable, today every one of those calls shows the "custom storage path unusable" error again, so one bad
setting floods the user with identical toasts. After this WP the check runs once per setting value and the error is
shown once.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `src/utils/storage.ts`: `getStorageBasePath`, `getTaskDirectoryPath`, `getSettingsDirectoryPath`,
  `getCacheDirectoryPath`, `promptForCustomStoragePath`.
- `src/utils/__tests__/storage.spec.ts` (uses the in-memory fs mock `src/__mocks__/fs/promises.ts`; the module under
  test is imported once per file, so module state survives between its tests).
- Callers (context only; none changes): `src/core/task-persistence/{apiMessages,taskMessages,taskMetadata,subagentSummariesStore,TaskHistoryStore}.ts`,
  `src/core/context-tracking/FileContextTracker.ts`, `src/core/message-manager/index.ts`, `src/core/task/TaskLifecycle.ts`,
  `src/core/tools/{ExecuteCommandTool,ReadArtifactTool,SearchTaskHistoryTool}.ts`, `src/core/artifacts/ArtifactStore.ts`,
  `src/core/webview/{diagnosticsHandler,TaskHistoryGateway,BackgroundTaskRunner,ClineProvider}.ts`,
  `src/core/webview/messageHandlers/debug.ts`, `src/core/agent-interchange/index.ts`, `src/utils/globalContext.ts`,
  `src/api/providers/fetchers/{modelCache,modelEndpointCache}.ts`.

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`src/utils/storage.ts`, `getStorageBasePath` with its doc comment (near line 9):

```ts
/**
 * Gets the base storage path for conversations
 * If a custom path is configured, uses that path
 * Otherwise uses the default VSCode extension global storage path
 */
export async function getStorageBasePath(defaultPath: string): Promise<string> {
	// Get user-configured custom storage path
	let customStoragePath = ""

	try {
		// This is the line causing the error in tests
		const config = vscode.workspace.getConfiguration(Package.name)
		customStoragePath = config.get<string>("customStoragePath", "")
	} catch (error) {
		console.warn("Could not access VSCode configuration - using default path")
		return defaultPath
	}

	// If no custom path is set, use default path
	if (!customStoragePath) {
		return defaultPath
	}

	try {
		// Ensure custom path exists
		await fs.mkdir(customStoragePath, { recursive: true })

		// Check directory write permission without creating temp files
		await fs.access(customStoragePath, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK)

		return customStoragePath
	} catch (error) {
		// If path is unusable, report error and fall back to default path
		console.error(`Custom storage path is unusable: ${error instanceof Error ? error.message : String(error)}`)
		if (vscode.window) {
			vscode.window.showErrorMessage(t("common:errors.custom_storage_path_unusable", { path: customStoragePath }))
		}
		return defaultPath
	}
}
```

`src/utils/storage.ts`, `getTaskDirectoryPath` (near line 53):

```ts
export async function getTaskDirectoryPath(globalStoragePath: string, taskId: string): Promise<string> {
	const basePath = await getStorageBasePath(globalStoragePath)
	const taskDir = path.join(basePath, "tasks", taskId)
	await fs.mkdir(taskDir, { recursive: true })
	return taskDir
}
```

`src/utils/storage.ts`, `promptForCustomStoragePath` (near line 118):

```ts
			const currentConfig = vscode.workspace.getConfiguration(Package.name)
			await currentConfig.update("customStoragePath", result, vscode.ConfigurationTarget.Global)
```

## 5. Root cause / analysis

VERIFIED (read):
- With NO custom path (the default), `getStorageBasePath` does no file system call: it reads the setting (an
  in-memory lookup) and returns. The claim "runs mkdir+access on every call" therefore holds only when a custom path
  is set; then every call does `mkdir(custom)` + `access(custom)`, and on failure logs and shows an error toast each
  time.
- `getTaskDirectoryPath` always does one more `mkdir(taskDir, { recursive: true })`.
- `getStorageBasePath` has 4 other users (`getSettingsDirectoryPath`, `getCacheDirectoryPath`, `TaskHistoryStore`
  near line 1516, `core/agent-interchange/index.ts:47`), so memoizing inside `getStorageBasePath` benefits all of them
  with one change.

Design (and why):
- Cache key = `JSON.stringify([defaultPath, customStoragePath])`. The setting is still read on every call (cheap,
  in-memory), and because its value is part of the key, a changed setting is checked on the next call. No
  `onDidChangeConfiguration` listener is needed: the brief's "invalidation when the custom storage setting changes"
  is provided by the key. The cached value is a `Promise<string>`, so parallel callers share one check and one toast.
- A failed check is cached too (default path, one toast). Consequence: after fixing the folder's permissions without
  changing the setting, tasks keep using the default path until the setting changes or the window reloads. This is
  deliberate (one storage root per session rather than one task's files split across two roots). Step 3 also clears
  the cache when the user sets the path again with the custom-storage-path command.
- The per-task `mkdir(taskDir)` is KEPT on every call. Deleting a task removes its folder (`TaskHistoryGateway`,
  `BackgroundTaskRunner`), and several writers write into the task folder with plain `fs` calls; memoizing "folder
  exists" would need invalidation at every delete site. Out of scope.

VERIFIED (run in a scratch copy with the `src` vitest setup): the spec of section 7 (6 existing + 6 new tests) passes
12/12 with the new code. Against the current code (plus a no-op `clearStorageBasePathCache` so the file loads) 4 new
tests fail: "checks a custom path once and reuses the result", "shares one check between parallel callers",
"reports an unusable custom path once, not on every call", "getTaskDirectoryPath still creates the task folder on
every call" (today `access` runs twice there).

## 6. Step-by-step changes

1. `src/utils/storage.ts`: replace the whole block quoted first in section 4 (the doc comment starting
   `/**` / ` * Gets the base storage path for conversations` down to the closing `}` of `getStorageBasePath`) with:

```ts
/**
 * Resolved base paths, by default path and configured custom path. The
 * configured value is part of the key, so a changed setting is checked on the
 * next call while an unchanged one costs no file system call. The promise is
 * stored so that parallel callers share one check and at most one error
 * message. An unusable custom path is remembered too: tasks keep one storage
 * root until the setting changes or the window reloads.
 */
const basePathCache = new Map<string, Promise<string>>()

/** Forgets every resolved base path (tests). */
export function clearStorageBasePathCache(): void {
	basePathCache.clear()
}

/**
 * Gets the base storage path for conversations
 * If a custom path is configured, uses that path
 * Otherwise uses the default VSCode extension global storage path
 */
export async function getStorageBasePath(defaultPath: string): Promise<string> {
	// Get user-configured custom storage path
	let customStoragePath = ""

	try {
		// This is the line causing the error in tests
		const config = vscode.workspace.getConfiguration(Package.name)
		customStoragePath = config.get<string>("customStoragePath", "")
	} catch (error) {
		console.warn("Could not access VSCode configuration - using default path")
		return defaultPath
	}

	// If no custom path is set, use default path
	if (!customStoragePath) {
		return defaultPath
	}

	const key = JSON.stringify([defaultPath, customStoragePath])
	let resolved = basePathCache.get(key)

	if (!resolved) {
		resolved = resolveCustomStoragePath(customStoragePath, defaultPath)
		basePathCache.set(key, resolved)
	}

	return resolved
}

/** Creates and checks a custom storage path; the default path when it is unusable. */
async function resolveCustomStoragePath(customStoragePath: string, defaultPath: string): Promise<string> {
	try {
		// Ensure custom path exists
		await fs.mkdir(customStoragePath, { recursive: true })

		// Check directory write permission without creating temp files
		await fs.access(customStoragePath, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK)

		return customStoragePath
	} catch (error) {
		// If path is unusable, report error and fall back to default path
		console.error(`Custom storage path is unusable: ${error instanceof Error ? error.message : String(error)}`)
		if (vscode.window) {
			vscode.window.showErrorMessage(t("common:errors.custom_storage_path_unusable", { path: customStoragePath }))
		}
		return defaultPath
	}
}
```

2. Leave `getTaskDirectoryPath`, `getSettingsDirectoryPath` and `getCacheDirectoryPath` unchanged (they call
   `getStorageBasePath` and profit automatically).

3. `src/utils/storage.ts`, `promptForCustomStoragePath`: find

```ts
			const currentConfig = vscode.workspace.getConfiguration(Package.name)
			await currentConfig.update("customStoragePath", result, vscode.ConfigurationTarget.Global)
```

   (the second `getConfiguration` in that function, inside `if (result !== undefined)`) and replace with

```ts
			const currentConfig = vscode.workspace.getConfiguration(Package.name)
			await currentConfig.update("customStoragePath", result, vscode.ConfigurationTarget.Global)
			// Setting the same path again (after fixing its permissions) must check it again.
			clearStorageBasePathCache()
```

4. Add the tests of section 7.

## 7. Tests to add or change

File: `src/utils/__tests__/storage.spec.ts` (unit level: path logic over the fs mock).

a) The existing `describe("getStorageBasePath - customStoragePath", ...)` must start each test without a cached
   result. Find its (the file's only) `beforeEach`

```ts
	beforeEach(() => {
		vi.clearAllMocks()
	})
```

   and replace with

```ts
	beforeEach(async () => {
		vi.clearAllMocks()
		// The resolved base path is memoized (P6); every test starts without it.
		const { clearStorageBasePathCache } = await import("../storage")
		clearStorageBasePathCache()
	})
```

b) Append at the end of the file:

```ts
describe("getStorageBasePath - memoized custom path check (P6)", () => {
	const defaultPath = "/test/global-storage"

	const setCustomPath = (customPath: string) =>
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(customPath),
		} as any)

	beforeEach(async () => {
		vi.clearAllMocks()
		const { clearStorageBasePathCache } = await import("../storage")
		clearStorageBasePathCache()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("checks a custom path once and reuses the result", async () => {
		setCustomPath("/test/storage/path")
		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		expect(await getStorageBasePath(defaultPath)).toBe("/test/storage/path")
		expect(await getStorageBasePath(defaultPath)).toBe("/test/storage/path")

		expect((fsPromises as any).mkdir).toHaveBeenCalledTimes(1)
		expect((fsPromises as any).access).toHaveBeenCalledTimes(1)
	})

	it("shares one check between parallel callers", async () => {
		setCustomPath("/test/storage/path")
		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		const results = await Promise.all([getStorageBasePath(defaultPath), getStorageBasePath(defaultPath)])

		expect(results).toEqual(["/test/storage/path", "/test/storage/path"])
		expect((fsPromises as any).access).toHaveBeenCalledTimes(1)
	})

	it("checks again when the setting changes", async () => {
		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		setCustomPath("/test/storage/path")
		await getStorageBasePath(defaultPath)
		setCustomPath("/test/storage/other")
		expect(await getStorageBasePath(defaultPath)).toBe("/test/storage/other")

		expect((fsPromises as any).access).toHaveBeenCalledWith("/test/storage/other", 7)
		expect((fsPromises as any).access).toHaveBeenCalledTimes(2)
	})

	it("keys the result by the default path too", async () => {
		const showErrorSpy = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined as any)
		setCustomPath("/test/storage/unusable")
		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")
		;((fsPromises as any).access as ReturnType<typeof vi.fn>)
			.mockRejectedValueOnce(new Error("EACCES"))
			.mockRejectedValueOnce(new Error("EACCES"))

		expect(await getStorageBasePath("/default/a")).toBe("/default/a")
		expect(await getStorageBasePath("/default/b")).toBe("/default/b")
		expect(showErrorSpy).toHaveBeenCalledTimes(2)
	})

	it("reports an unusable custom path once, not on every call", async () => {
		const showErrorSpy = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined as any)
		setCustomPath("/test/storage/unusable")
		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")
		;((fsPromises as any).access as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("EACCES"))

		expect(await getStorageBasePath(defaultPath)).toBe(defaultPath)
		expect(await getStorageBasePath(defaultPath)).toBe(defaultPath)

		expect(showErrorSpy).toHaveBeenCalledTimes(1)
	})

	it("getTaskDirectoryPath still creates the task folder on every call", async () => {
		setCustomPath("/test/storage/path")
		const fsPromises = await import("fs/promises")
		const { getTaskDirectoryPath } = await import("../storage")
		const path = await import("path")
		const taskDir = path.join("/test/storage/path", "tasks", "task-1")

		expect(await getTaskDirectoryPath(defaultPath, "task-1")).toBe(taskDir)
		expect(await getTaskDirectoryPath(defaultPath, "task-1")).toBe(taskDir)

		const taskDirMkdirs = (fsPromises as any).mkdir.mock.calls.filter(([p]: [string]) => p === taskDir)
		expect(taskDirMkdirs).toHaveLength(2)
		expect((fsPromises as any).access).toHaveBeenCalledTimes(1)
	})
})
```

Why they fail without the fix: today every call runs `mkdir` + `access` again and shows the toast again, so the
call-count assertions see 2 instead of 1 (and `clearStorageBasePathCache` does not exist yet, so the `beforeEach`
throws: write the tests, run them, see the failure, then apply section 6).

Note on the mocks: `vi.clearAllMocks()` clears calls but not implementations, so the failure cases use
`mockRejectedValueOnce` (not `mockRejectedValue`); a permanent rejection would leak into later tests.

## 8. Commands to run (exact, from which directory) and the expected result

1. Tests first: `cd /home/user/Tumble-Code/src && npx vitest run utils/__tests__/storage.spec.ts` -> fails.
2. Apply section 6, re-run -> 12 passed.
3. Callers' specs: `cd /home/user/Tumble-Code/src && npx vitest run core/task-persistence core/artifacts core/tools core/context-tracking core/message-manager core/webview utils`
   -> same result as origin/main (most mock `utils/storage` or use an empty custom path; the ones that use the real
   module with a mocked `getConfiguration`, `subagentSummariesStore.spec.ts` and `RunParallelTasksTool.spec.ts`,
   return "" as custom path and never reach the cache).
4. `cd /home/user/Tumble-Code/src && pnpm check-types` -> no errors.
5. `cd /home/user/Tumble-Code/src && npx eslint utils/storage.ts utils/__tests__/storage.spec.ts --max-warnings=0`.
6. `cd /home/user/Tumble-Code && npx prettier --check src/utils/storage.ts src/utils/__tests__/storage.spec.ts`.

## 9. Do not touch / pitfalls

- `TaskHistoryStore` is on the do-not-touch list; it calls `getStorageBasePath` and gets the same value as before
  (only fewer file system calls). Do not edit `TaskHistoryStore.ts`.
- Do not memoize the per-task `mkdir` in `getTaskDirectoryPath` (section 5).
- Keep the early returns (configuration unreadable, no custom path) uncached and free of file system calls; the
  existing test "returns the default path when customStoragePath is an empty string and does not touch fs" pins that.
- Do not register a VS Code configuration listener in this module (not needed with the key; `packages/vscode-shim`,
  used by the CLI, is on the do-not-touch list).
- Known flaky: F2 (Windows TaskHistoryStore lock count) is unrelated.

## 10. Acceptance checklist (checkboxes)

- [ ] `getStorageBasePath` caches the custom-path check per (default path, custom path); parallel callers share it.
- [ ] `clearStorageBasePathCache` exported (as `export function`), called in `promptForCustomStoragePath` and in the spec's `beforeEach`.
- [ ] `storage.spec.ts`: 12 tests pass; the new ones failed before the change.
- [ ] Callers' test folders pass as on origin/main; check-types, eslint, prettier clean.

## 11. Commit, changeset and PR text

Commit title: `perf(storage): check the custom storage path once per setting value (P6)`

Body:

```
getStorageBasePath ran mkdir and access on the custom storage path for every
task file read or write, and showed the "unusable path" error on every call.
The result is now memoized per (default path, configured custom path) as a
shared promise, so a changed setting is checked on the next call and parallel
callers share one check. Setting the path again through the command clears
the cache. The per-task mkdir is unchanged.

<the commit attribution trailers your harness requires>
```

`.changeset/p6-memoize-storage-base-path.md`:

```
---
"tumble-code": patch
---

With a custom storage path set, saving and reading task files no longer re-checks the storage folder on every
access, and an unusable custom storage folder is reported once instead of on every save.
```

`ai_plans/2026-MM-DD_p6-memoize-storage-base-path.md`:

```
# P6: memoized storage base path

Item P6 of `2026-09-27_simplification-roadmap.md`.

## Problem
getStorageBasePath (used by getTaskDirectoryPath on every task file access) ran mkdir + access on a configured
custom storage path every time and showed the unusable-path toast every time.

## Change
Cache of Promise<string> keyed by [defaultPath, customStoragePath]; failures cached too (one toast);
clearStorageBasePathCache() for the prompt command and tests. Per-task mkdir kept (task folders get deleted).

## Tests
storage.spec.ts: once per value, shared by parallel callers, re-check on setting change, keyed by default path,
one toast, task folder still created per call.
```

PR body outline: Summary; design (key includes the setting value, no listener; failures cached, reason); not changed
(task mkdir); tests; end with the PR attribution footer your harness requires (see 00-README.md, section 3).

## 12. If stuck

- If a caller's spec fails because it expected the error toast on every call, report the spec name and output; do
  not drop the failure caching without asking.
- If `tsc` flags `clearStorageBasePathCache` in `promptForCustomStoragePath` as used before definition, you declared
  it as a `const` arrow; it must be `export function clearStorageBasePathCache(): void` (hoisted).
