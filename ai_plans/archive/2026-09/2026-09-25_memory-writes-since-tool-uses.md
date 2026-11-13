# Memory extraction ignored the main agent's own memory writes

Branch: `fix/memory-writes-since-tool-uses` (off main 99d28803c).
Recorded as "Not covered" in `ai_plans/2026-09-25_memory-writers-after-completion.md`.

## Symptom

`executeExtractMemories` (src/core/memory/extractMemories.ts) has a mutual-exclusion
gate: if the main agent already wrote a memory file since the last extraction, skip the
extraction and advance the cursor. The gate never fired, so the background extraction
sub-task was spawned after every completed top-level task, even right after the agent had
saved the same memory itself (an extra model call, and a chance of a duplicate memory).

## Evidence

- The only caller, `TaskLifecycle.triggerMemoryBackgroundWriters`, passes
  `this.access.clineMessages` with a double cast
  (`as unknown as ExtractionMessageView[]`), which hid the shape mismatch from the
  compiler.
- `hasMemoryWritesSince` read `message.toolUses[].input.path/file_path`. `ClineMessage`
  (packages/types/src/message.ts) has no `toolUses` field.
- Real data, read-only census over the owner's
  `~/.config/Code/User/globalStorage/qub-it.tumble-code/tasks/*/ui_messages.json`
  (1042 task files): 0 files contain any message with `toolUses`; 112 tasks contain 283
  approved file-write asks into a memory directory (190 of them into the directory
  shared with Claude Code, `~/.claude/projects/<slug>/memory/`). These include the
  background writer tasks themselves, but any single main-agent write was enough for the
  gate to fire and it never could.
- Real shape of such a write (task 019f80ec-..., message 9):
  `{ type: "ask", ask: "tool", partial: false, isAnswered: true, text: "{\"tool\":\"newFileCreated\",\"path\":\"/home/krzych/.config/Code/User/globalStorage/qub-it.tumble-code/memory/projects/<sanitized cwd>/memory/rke2_cluster_kubeconfig.md\", ...}" }`.

## Root cause

The detector was ported from Claude Code, where messages carry tool-use blocks. In this
codebase a file write is only visible in `clineMessages` as the tool-approval ask:

- write_to_file asks with `tool: "newFileCreated" | "editedExistingFile"`; apply_diff,
  edit, search_replace, edit_file and apply_patch ask with `tool: "appliedDiff"`.
- `path` is `getReadablePath(cwd, relPath)`: relative to `cwd` (POSIX separators) inside
  the workspace, absolute (POSIX separators) outside it, which is the normal case for the
  memory directory (global storage or the Claude Code directory).
- `isAnswered` is set on approval: by auto-approval when the ask is created
  (`TaskAskSay.ask`) and by `handleWebviewAskResponse("yesButtonClicked")`. A rejected
  ask keeps it unset. The only other way to get `isAnswered` without approval is an
  auto-deny from a per-task `autoApprovalOverride`, which only background tasks have, and
  those never run extraction.

## Fix

`hasMemoryWritesSince` now counts a message when it is `type: "ask"`, `ask: "tool"`, not
`partial`, `isAnswered === true`, and its JSON `text` has a file-write `tool` and a `path`
that, resolved against `cwd`, is inside `getAutoMemPath(cwd)` (via `isAutoMemPath`, so
the shared-with-Claude-Code layout and the directory override are covered). Malformed
text is skipped. `ExtractionMessageView` is now a `Pick` of `ClineMessage`, and the
double cast in `TaskLifecycle` is gone, so a future shape drift fails the type check.

Cursor semantics are unchanged: the cursor is an index into `clineMessages`, the scan
covers `[cursor, length)`, and on a detected write the cursor advances to the length
snapshotted before the scan.

Known limits (unchanged, out of scope): a memory written through `execute_command`
(for example `cat > file`) is not detected; an approved write that then fails on disk
still counts as a write (no success marker is stored in `clineMessages`).

## Tests

`src/core/memory/__tests__/extractMemories.spec.ts`: the detector specs used the fake
`toolUses` shape and passed while the gate was dead. They now build asks in the real
shape (with the real `getReadablePath`) and cover every write tool name, a cwd-relative
path, the shared Claude Code directory, a rejected ask, a partial ask, a non-write ask,
the cursor bound and malformed text; the two `executeExtractMemories` mutual-exclusion
specs use the real shape too. Eight fail on main, all pass with the fix; the detector
specs also pass with `path` emulated as `path.win32`.
