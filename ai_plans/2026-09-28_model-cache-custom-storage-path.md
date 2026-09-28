# Model cache: the cold read ignores `customStoragePath`

Branch `fix/model-cache-custom-storage-path`, from `origin/main` at `86ca2492b`.

Source: residual recorded in `ai_plans/2026-09-28_p10-async-file-io.md` ("The synchronous cold read in `getModelsFromCache` looks in `<globalStorage>/cache`, while writes go through `getCacheDirectoryPath`, which honours `customStoragePath`").

## Root cause (verified on main)

`src/api/providers/fetchers/modelCache.ts`:

- Writes (`writeModels`) and the asynchronous read (`readModelsFromDisk`) both resolve the directory with `getCacheDirectoryPath(globalStorage)` from `src/utils/storage.ts`, which calls `getStorageBasePath` and therefore uses the `customStoragePath` setting when it is set and usable.
- The synchronous cold read in `getModelsFromCache` (the first lookup of each provider in a process) used a private `getCacheDirectoryPathSync()` that returned `path.join(globalStorage, "cache")`, hard-coded, without looking at the setting.

Consequence with a custom storage path: after a restart the first `getModelsFromCache(provider)` misses the file the previous process wrote, returns `undefined`, and the P10 disk mirror remembers the miss (`null`) for 5 minutes. Callers such as `RouterProvider.getModel` (`src/api/providers/router-provider.ts:75`) and `resolveModel` for openrouter/litellm/ollama (`src/api/runtime-provider-registry.ts:143,152,161`) then fall back to default model info (context window, prices) until something async (`getModels`, or the background revalidation after 5 minutes) fills the memory cache. If a stale file from before the user set the custom path is still in `<globalStorage>/cache`, that stale list is served instead.

Evidence: the new spec `src/api/providers/fetchers/__tests__/modelCache.custom-storage.spec.ts` (real temp directories, `vscode` configuration mocked to return a custom path, fresh module state per case) fails 3 of 4 cases on main:

- file only in the custom path: `expected undefined to deeply equal { 'vendor/model-a': ... }`
- stale file in global storage plus current file in the custom path: the stale list is returned
- round trip: `getModels` writes into `<custom>/cache` (asserted), a fresh module then reads `undefined`

The fourth case (no custom path, file in global storage) passes on main and pins that the default behaviour is unchanged.

## Fix

- `src/utils/storage.ts`: the setting read moved into a private `readCustomStoragePath()` (shared by both functions, same `console.warn` fallback as before), and a new exported `getStorageBasePathSync(defaultPath)` returns the configured custom path or `defaultPath`. It performs no file system call (reading the VS Code configuration is in memory), so no synchronous I/O is added. It does not create or check the custom directory; the only caller already treats a missing file as a miss (`existsSync` in the cold read, which was there before).
- `modelCache.ts`: `getCacheDirectoryPathSync()` builds `path.join(getStorageBasePathSync(globalStorage), "cache")`.

The P6 memo (`storageBasePathCache`) is not reused: it only stores successful custom-path validations, whose value is the configured string itself, so it adds nothing for the sync path, and it is empty at cold start anyway.

## Tests

- `modelCache.custom-storage.spec.ts` (new, 4 cases): see above; 3 fail on main, all pass after the fix.
- `src/utils/__tests__/storage.spec.ts`: 3 new cases for `getStorageBasePathSync` (custom path returned without `mkdir`/`access`, default when unset, default when the configuration throws).
- Re-run and green: `modelCache.spec.ts`, `modelCache.disk-io.spec.ts`, `openrouter.spec.ts`, `lite-llm.spec.ts`, `grace-retry-errors.spec.ts`, `ClineProvider.apiHandlerRebuild.spec.ts`.

## Residuals

- Custom path set but unusable (not writable): `getStorageBasePath` falls back to global storage for writes and shows an error, while the sync read looks in the custom path and misses. The asynchronous paths still read the right place, so this only affects the first lookup, and the user already sees an error about the path. Mirroring the fallback synchronously would need an `accessSync` on the cold path; not worth it.
- Checked for the same pattern elsewhere: `modelEndpointCache.ts` reads and writes only through the async `getCacheDirectoryPath`, and no other non-spec file in `src/` builds a `"cache"` directory by hand, so this was the only mismatch.
