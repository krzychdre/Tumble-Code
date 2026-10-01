# One helper for a mode's `rules-<slug>` folder

Status: implemented on `fix/mode-rules-dir-single-helper` (simplification round 2, item A12).

## Touched files

- `src/core/config/modeRulesDir.ts` (new)
- `src/core/config/CustomModesManager.ts`
- `src/core/webview/messageHandlers/customModes.ts`
- `src/core/config/__tests__/modeRulesDir.spec.ts` (new)
- `src/core/webview/__tests__/webviewMessageHandler.spec.ts`
- `.changeset/mode-rules-dir-no-workspace.md`

## Problem

The `rules-<slug>` folder of a mode was joined by hand in five places:

- `CustomModesManager.deleteRulesFolder` (old lines 626-638), `checkRulesDirectoryHasContent` (718-730),
  `exportModeWithRules` (818-835), `importRulesFiles` (913-921);
- the `deleteCustomMode` webview handler (`messageHandlers/customModes.ts`, old lines 89-102).

They disagreed on the no-workspace case. `getWorkspacePath()` returns `""` with no folder open; the handler then
fell back to `path.join(".roo", "rules-<slug>")`, a relative path resolved against the extension host's cwd: the
delete dialog could offer that folder and `fs.rm` would delete it. `deleteRulesFolder` returned early in the same
case. `RooDirectoryResolver` (`src/services/roo-config/RooDirectoryResolver.ts`) already lists the `rules-<mode>`
directories (global and project).

## Fix

`modeRulesDir(slug, source)` takes the `global` or `project` entry of
`RooDirectoryResolver.list(workspace, { kind: "rules", mode: slug })` and returns `undefined` for a project mode when
no workspace is open. All five places use it. Each caller keeps its own rule for which source a mode belongs to
(delete: missing source = global; check/export: anything but `global` = project) and its own no-workspace answer
(skip, `false`, "No workspace found"). The handler now reports no rules folder and deletes nothing in that case.

## Tests

- `modeRulesDir.spec.ts`: global path with and without a workspace, project path, no workspace = undefined.
- `webviewMessageHandler.spec.ts`: "never offers or deletes a relative rules folder for a project mode with no
  workspace" (fails on the old handler: it posted `.roo/rules-<slug>` and called `fs.rm`).
- Existing `CustomModesManager*.spec.ts` and `webviewMessageHandler.spec.ts` pass unchanged.

## Notes / caveats

- Not changed: the handler deletes the rules folder itself and `customModesManager.deleteCustomMode` deletes it
  again through `deleteRulesFolder` (the second `fs.rm` is a no-op with `force: true`). Merging the two is a
  separate cleanup.
