# P10: synchronous file I/O on hot paths

Roadmap item P10 from `ai_plans/2026-09-27_simplification-roadmap.md` (section 4):

> Sync file I/O on hot paths: `ArtifactStore.save` (also not atomic), `modelCache`, `MdmService`. Fix: `fs/promises` and `safeWriteJson`.

Branch `perf/p10-async-file-io`, from `origin/main` at `eaeb9676a`.

## Verification on main (line numbers of `origin/main` at `eaeb9676a`)

### 1. `ArtifactStore.save`: hot path, fixed

`src/core/artifacts/ArtifactStore.ts:198-213`: `existsSync` + `mkdirSync` for the directory, an `existsSync` loop for the id, then `writeFileSync(filePath, payload)` of up to 10 MB (`MAX_ARTIFACT_BYTES`).

Callers, both per turn:

- `src/core/artifacts/spillPolicy.ts:242` (`applyToolResultSpill`), called from `Task.pushToolResultToUserContent` (`src/core/task/Task.ts:751`) for every tool result larger than the inline budget, i.e. while the agent loop is running.
- `src/core/condense/toolResultPruner.ts:285` (`pruneToolResults`), called from `manageContext` (`src/core/context-management/index.ts:528`) under context pressure, once per oversized old result.

Not atomic: `writeFileSync` straight to the final name. A crash or an `ENOSPC` in the middle leaves a truncated file under a valid artifact id, and `read_artifact` would serve it as if it were the whole output.

The class comment explained why it was synchronous: `pushToolResultToUserContent` is synchronous (about a dozen call sites, it returns `boolean`), and the spill may only replace the text with a preview once the artifact exists.

### 2. `modelCache`: hot path, fixed

`src/api/providers/fetchers/modelCache.ts:225-270` `getModelsFromCache` is synchronous because `getModel()` is. It runs on every request: `RouterProvider.getModel` (`src/api/providers/router-provider.ts:75`, whenever the model id is not in the instance list), `resolveModel` of openrouter, litellm and ollama (`src/api/runtime-provider-registry.ts:143,152,161`), `resolveLmStudioModel` (`src/api/providers/lm-studio.ts:219`), and `getModels` itself (`modelCache.ts:92`).

On a memory miss it did `existsSync` + `readFileSync` + `JSON.parse` + zod validation on the event loop (lines 244-245). The memory cache has a 5 minute TTL (line 22), so this happened again after every expiry, and for a provider with no cache file (LM Studio or LiteLLM offline, a fetch that never succeeded) EVERY call paid an `existsSync`.

Measured by the new spec on main: 20 lookups across 20 memory expiries = 20 synchronous reads; 50 lookups with no cache file = 50 `existsSync` calls; a cold `getModels` = 2 synchronous calls.

Writing already used `safeWriteJson` (`writeModels`, line 35), so nothing to change there.

### 3. `MdmService`: NOT a hot path, left as is

`src/services/mdm/MdmService.ts:124,129`: `existsSync` + `readFileSync` of `/etc/roo-code/mdm.json` (or the macOS/Windows equivalent), a file of a few bytes. The only caller is `MdmService.createInstance`, awaited once during activation (`src/extension.ts:198`). One tiny read at startup inside an already sequential `activate` saves nothing measurable when made asynchronous, and the rewrite would churn a 30-case spec that mocks the synchronous calls. Kept unchanged on purpose.

## Fix

### ArtifactStore

- `save` is `async` and returns `Promise<SavedArtifact>`. `mkdir`, the collision probe (`access`) and the write all use `fs.promises`.
- Atomic write: payload to `.<id>.<pid>.<random>.tmp` in the same directory (`flag: "wx"`), `fsync` (same reasoning as `safeWriteJson`), then `rename` to the final id. On any error the temp file is unlinked and `save` rejects, so neither a partial artifact nor a temp file is left behind.
- Collision safety survives the interleaving that async introduces: a module level set of claimed paths is updated synchronously before any await, so concurrent saves in the same millisecond get consecutive ids; the disk probe still skips ids written earlier (resumed task, another window).
- `safeWriteJson` is not used: an artifact is plain text, not JSON, and needs no inter-process lock (ids are unique per process and probed on disk).

### Spill policy and Task

- `applyToolResultSpill` is `async` and awaits the store.
- `Task.pushToolResultToUserContent` keeps its synchronous signature and `boolean` result (no caller changes). It pushes the result INLINE, then starts the spill in the background. When the artifact write resolves, the block is replaced in place by the preview that cites it. If the write fails, the result simply stays inline, the same outcome as before. So a preview never cites an artifact that is not on disk, and missing a settle point only costs context, never correctness.
- `Task.settlePendingToolResultSpills()` waits for all pending spills. It is called by both consumers of `userMessageContent`:
    - `TaskApiLoop.finalizeStreamAndProcessResults`, right after the `userMessageContentReady` wait and before the results are snapshotted onto the request stack,
    - `TaskMessageLog.flushPendingToolResultsToHistory` (delegation, flush on failure), before building the user message.
- Both access interfaces (`TaskApiLoopAccess`, `TaskMessageLogAccess`) gain the method; `Task` implements it.
- If a block has already left `userMessageContent` when its write finishes (abort), the artifact is unlinked so it does not become an orphan.

### Pruner

- `pruneToolResults` is `async`. The two nested `map`s became sequential `for` loops so every write is awaited before the next result is judged; ids are minted in history order exactly as before. `manageContext` already was async and now awaits it.

### modelCache

- A per-provider disk mirror (`{ models | null, checkedAt }`) remembers what this process last read from or wrote to the cache file.
- `getModelsFromCache`: memory, then mirror, then (only when the provider has never been looked up in this process) the old synchronous cold read. A cold start must not fall back to default model info, so that single read stays synchronous on purpose. Once the mirror is older than 5 minutes, the file is revalidated asynchronously in the background (deduplicated per provider), which keeps picking up a list another window wrote.
- `getModels` (already async) reads the disk with `fs.promises.readFile` on a memory miss and never needs the synchronous path.
- `writeModels` updates the mirror after `safeWriteJson`.
- `resetModelCacheForTests()` clears the mirror; the existing spec calls it so each case starts cold.

## Tests (test first)

Commit 1 adds failing specs, commit 2 the fix.

- `src/core/artifacts/__tests__/ArtifactStore.spec.ts`: `save` returns a promise; no `existsSync`/`mkdirSync`/`writeFileSync`/`renameSync` (spied through a `vi.mock("fs")` wrapper, `vi.spyOn` cannot redefine an ESM namespace export); a write that fails midway leaves no artifact and no temp file; an existing artifact survives a failing write untouched; concurrent same-millisecond saves get distinct ids; an id already on disk is skipped.
- `src/core/condense/__tests__/toolResultPruner.spec.ts`: the pass returns a promise.
- `src/core/task/__tests__/Task.spec.ts`: a spilled result is inline until `settlePendingToolResultSpills`, then the preview; a failed write keeps it inline.
- `src/core/task/__tests__/TaskApiLoop.abort-during-tool.spec.ts`: the loop settles pending spills before snapshotting.
- `src/core/task/__tests__/flushPendingToolResultsToHistory.spec.ts`: a flush persists the preview once a slow write settles.
- `src/api/providers/fetchers/__tests__/modelCache.disk-io.spec.ts` (new, real temp directory): at most one synchronous read across 20 memory expiries; at most one `existsSync` across 50 lookups with no file; `getModels` makes no synchronous call; a freshly fetched list survives memory expiry without a disk read; a file written by another window is picked up in the background.
- Existing artifact, spill and pruner specs now `await` the async calls.

## Residuals

- `ArtifactStore.openWriteStream` (used by `OutputInterceptor` once per command that exceeds its preview) still does `existsSync` + `mkdirSync`; the stream is opened from the synchronous `OutputInterceptor.write`. Once per long command, not per chunk; left out of scope.
- The synchronous cold read in `getModelsFromCache` looks in `<globalStorage>/cache`, while writes go through `getCacheDirectoryPath`, which honours `customStoragePath`. Pre-existing mismatch; the async paths use the right directory and the mirror covers everything this process wrote, so it now only matters for the first lookup after startup.
- A process crash between the temp write and the rename can leave a `.tool-<n>.txt.<pid>.<random>.tmp` file in the task's `artifacts` directory. It is never served (not a valid id) and goes away with the task directory.
