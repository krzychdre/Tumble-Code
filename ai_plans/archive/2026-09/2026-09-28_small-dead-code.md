# Small dead code: three leftovers from S6 round 2 and S7

Branch `chore/small-dead-code`, from `origin/main` at `3e17bc5c4`. Three
pieces of code that nothing can reach, found while writing
[S6 round 2](2026-09-28_s6-round2-src-type-safety.md) and
[S7](2026-09-28_s7-split-extension-message-types.md). Each was verified dead
before removal; none changes what the user sees.

## 1. `insertTextIntoTextarea` (host to webview message)

What it was: a case in `ChatTextArea`'s host-message handler that inserted
`message.text` at the cursor, the name in the `ExtensionMessage` type union
(`packages/types/src/vscode-extension-host/taskLifecycle.ts`), the same name
in the type-surface spec, and one characterization test in
`ChatTextArea.mentionMenu.spec.tsx`.

Evidence that nothing sends it:

- `git grep insertTextIntoTextarea` over the whole repo (src, webview-ui,
  apps/cli, packages, everything but `ai_plans`) finds only the webview
  handler, the type name and the two specs. No `postMessageToWebview`, no CLI
  or cloud producer.
- History (`git log -S`): the only producer was the webview-to-host case of
  the same name in `webviewMessageHandler`, which relayed it straight back;
  it was deleted in CORE-Q quick wins (#267, `86023b889`) as an unsent
  message. The receiving half stayed behind.

Removed: the handler branch, `"insertTextIntoTextarea"` from the
`onExtensionMessage` subscription list, `inputValue` from that effect's
dependency list (only the removed branch read it), the union member, the
surface-spec entry and the test. The React Compiler bailout count is
unchanged (8, the baseline).

## 2. `alreadyHandled` in `CustomModesManager.loadModesFromFile`

The catch block logged only `if (!error.alreadyHandled)`. Evidence that the
flag is never set:

- `git grep alreadyHandled` finds only that read.
- It came in with #5099 (`e559beee6`), whose diff also only reads it.
- `parseYamlSafely` catches its own YAML/JSON errors, reports them and
  returns `{}`; it never throws, so it cannot hand a flagged error to the
  caller. The errors that do reach the catch are `fs.readFile` failures and
  unexpected shapes, and none of them carries the flag.

So the condition was always true and every caught error was already logged.
The check is removed; the log line and the `[]` result are unchanged.

## 3. `ExtensionMessage.branch` and `hasWorktreeInclude`

Left in `packages/types/src/vscode-extension-host.ts` by S7 (with a comment
saying nothing uses them) after `branchWorktreeIncludeResult` was removed.
Evidence:

- `git grep hasWorktreeInclude` outside `ai_plans` finds only the
  `WorktreeIncludeService.hasWorktreeInclude()` method in `packages/core`
  (a different thing) and the type-surface spec.
- The `branch:` hits are `Worktree.branch` (`packages/types/src/worktree.ts`)
  and the `createWorktree` options, not `ExtensionMessage`.
- After deleting both fields, `tsc --noEmit` is clean in `packages/types`,
  `src`, `webview-ui` and `apps/cli` (the packages that import
  `ExtensionMessage`): no object literal sets them and no code reads them.

Removed the two fields, their comment and their entries in the surface spec.

## Tests

- Commit 1, characterization (passes on main unchanged):
  `CustomModesManager.spec.ts` +1, a `.roomodes` read failure is logged once
  as `Failed to load modes from <path>: <message>` and the global modes
  still load.
- Commit 2, the removals. The `enhancedPrompt` handling that shares the
  effect stays covered by `ChatTextArea.spec.tsx`.
- Run with `--maxWorkers=2`: `CustomModesManager*` (4 files, 75 tests),
  `ChatTextArea*` (5 files, 108 tests), `packages/types`
  `vscode-extension-host*` specs (2 files, 9 tests): all green. tsc clean in
  the four packages above, eslint clean on touched files.
