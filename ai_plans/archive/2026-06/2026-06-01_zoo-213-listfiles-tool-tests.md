# Zoo PR #213 — comprehensive ListFilesTool test suite

- **Upstream:** Zoo-Code #213 (closes #209), commit `07f1bdca4`, merged 2026-05-27 (commit 13:19:24Z — oldest of the 05-27 candidate group by `%cI` tie-break), authors Armando Vaquera + edelauna.
- **Branch:** `feature/zoo-213-listfiles-tool-tests` (off `main`).
- **Credit:**
    - `Co-authored-by: Armando Vaquera <263793884+proyectoauraorg@users.noreply.github.com>`
    - `Co-authored-by: edelauna <54631123+edelauna@users.noreply.github.com>`

## What this PR is

Test-only: adds `src/core/tools/__tests__/listFilesTool.spec.ts` (594 lines, 40 tests).
No product change. Covers `ListFilesTool` (class) + `listFilesTool` (singleton):
parameter validation, recursive/non-recursive listing, approval flow + rejection,
relative/absolute path resolution, `showRooIgnoredFiles` provider-state plumbing,
`rooIgnore`/`rooProtected` passthrough, error handling (listFiles / formatFilesList
throw; mistake-count reset semantics), `handlePartial` streaming (recursive string
parsing incl. case-insensitive "TRUE", error propagation vs. `.catch` of `task.ask`),
edge cases (empty/large/root/dot paths), and singleton identity. Uses
`path.resolve`/`path.sep` for Windows-CI cross-platform safety.

## Fork compatibility (verified)

- Fork `src/core/tools/ListFilesTool.ts` already exports both `ListFilesTool` (extends
  `BaseTool<"list_files">`) and `const listFilesTool = new ListFilesTool()` — identical
  surface to upstream HEAD.
- Only fork delta vs upstream: `sharedMessageProps` stamps `toolCallId` (from callbacks
  in `execute`, from `block.id` in `handlePartial`). In the tests the callbacks/block
  carry no id, so `toolCallId` is `undefined` and `JSON.stringify` omits it — the
  `toEqual({tool, path, isOutsideWorkspace, content})` message-structure assertions still
  hold. `execute(params, task, callbacks)` and `handlePartial(task, block)` signatures
  match the test calls exactly.
- Internal `roo*` identifiers (`rooIgnoreController`, `rooProtectedController`,
  `showRooIgnoredFiles`) stay as-is — rebrand keeps internal IDs; no Tumble renaming in
  tests.

Conclusion: the upstream spec ports verbatim (extracted via `git show`, no edits needed).

## Scope / skip

No changeset (fork port workflow omits them). Test file only.

## Verification

- `npx vitest run core/tools/__tests__/listFilesTool.spec.ts` (from `src/`) — expect 40 pass.
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
