# `.rooignore` and the shell tool: missing readers, globs, recursive and unknown reads

**Status:** fixed on `fix/rooignore-shell-best-effort`
**Related:** security audit 2026-10-28, section 10 (residual after de6d02e27)
**Touched:** `src/core/ignore/RooIgnoreController.ts`, `src/core/tools/ExecuteCommandTool.ts`,
`src/core/auto-approval/index.ts` (comment), `src/core/ignore/__mocks__/RooIgnoreController.ts`, the specs of both,
`webview-ui/src/i18n/locales/*/settings.json` (`contextManagement.rooignore.description`)

## Symptom

With `.rooignore` = `secrets/**` and an auto-approved command, these read ignored files with no prompt: `grep -r x .`,
`tar cf - secrets`, `cp -r secrets /tmp/x`, `find secrets -exec cat {} +`, `cat sec*/key.txt`,
`dd if=secrets/key.txt`, `git show HEAD:secrets/key.txt`, `git cat-file -p HEAD:secrets/key.txt`, `python3 -c ...`,
`cat "$F"`. `validateAccess` allowed on any exception, and no user-facing text said `.rooignore` does not fully bind
`execute_command`.

## What was happening

`findIgnoredRead` checked the arguments of the commands in `FILE_READING_COMMANDS` one by one as paths. A directory
argument (`secrets`) does not match `secrets/**`, a recursive reader with no path reads the cwd, a glob was checked as
the literal text `sec*/key.txt`, `dd` and `git` name files inside a word (`if=...`, `REV:path`), and interpreter code or
an expansion names no path at all. `validateAccess` returned `true` from its `catch`, which also covered the ignore
library's `RangeError` for paths outside the cwd.

## Fix

- One traversal (`collectReads`) records what a command reads: an ignored file it names, whether it reads something
  only known when it runs, and the directories it reads as a whole. `validateCommand` blocks on the first; the new
  `commandMayReadIgnored` answers the other two.
- Blocked like before, now also: `READ_OPERANDS` table (`dd if=`, `git show|cat-file REV:path`), globs expanded against
  the filesystem as bash does (segment by segment, dotfiles only for a dot segment), and `~`/`$HOME` through
  `expandedPath` (shared with the protected-file check).
- Asked, not blocked: `RECURSIVE_READERS` table (`grep/egrep/fgrep -r|-R`, `rg`, `cp -r|-a`, `rsync -r|-a`,
  `scp -r`, `zip -r`, `tar c|r|u`, `find ... -exec <reader>`) when a directory it reads holds an ignored path (a
  breadth-first walk that stops at the first one, ignores the `.rooignore` itself whose text is in the prompt anyway, and
  answers yes past 20,000 entries; a directory above the cwd is walked from the cwd); interpreter code (`code` from the
  wrapper table); a reader argument with an expansion other than `~`/`$HOME`.
- `ExecuteCommandTool` ORs `commandMayReadIgnored` into the flag it already passes to the approval for protected
  writes, so an auto-approved command asks.
- `validateAccess`: the cwd itself and paths outside it are allowed explicitly; any other exception now denies. No
  `.rooignore` still allows.
- The `.rooignore` setting's description (all 18 locales) says shell commands are covered on a best-effort basis: known
  readers are blocked, commands that cannot be checked ask.

## Tests

`RooIgnoreController.spec.ts`: 4 new rows in the "blocks" table (`dd`, `git show`, `git cat-file`, glob), 3 in "allows"
(`dd of=` into an ignored folder, `git show` of an allowed file, a glob of allowed files); a new `commandMayReadIgnored`
block with a 12-row "asks" table, a 7-row "does not ask" table, the `.rooignore`-only tree, the walk limit and the
no-`.rooignore` case. The filesystem is replaced at `readdirSync` by a small tree. `executeCommandTool.spec.ts`: the flag
reaches `askApproval`.

Mutation checks, each red then restored: `dd` entry (1), `git` entry (2), glob expansion (1), recursive table off (10),
code check off (1), unknown argument off (2), `.rooignore` counted (1), walk limit off (1), no walk from the cwd for a
parent directory (1), `find` without the reader check (1), no default `.` for grep/rg (2), outside-cwd allow broken (5),
old-style `tar cf` (1), the flag dropped in `ExecuteCommandTool` (1).

## Not fixed

- With `alwaysAllowWriteProtected` on, the ask for an unchecked read is skipped too: both reasons share the
  `isProtected` flag of the approval (separating them means threading a second flag through `askApproval`,
  `TaskAskSay.ask`, the override and `checkAutoApproval`).
- Readers outside both tables (`git diff`, `git log -p`, `xargs cat` fed by `find`, `sed`'s `r` command, an editor's
  script) still read without a prompt; `git show REV:path` is resolved from the directory the command runs in, not
  from the repository root.
- The `catch` in `validateAccess` has no test: after the outside-cwd check no input is known to reach it.
