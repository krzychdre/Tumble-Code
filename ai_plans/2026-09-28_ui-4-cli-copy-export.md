# UI plan §4 (CLI), part 5: `/copy` and `/export`

Source: `ai_plans/2026-09-27_ui-modernization.md` §4, bullet "... `/copy` for the last answer or code block, `/export`
to Markdown". Branch `feat/ui-4-cli-copy-export`, stacked on `feat/ui-4-cli-history-resume` (split from it to keep
each PR reviewable).

## What existed (verified)

Nothing: the CLI's own slash commands were `/new`, `/clear`, `/permissions`, `/mcp` (and `/resume` from part 4).
The rows of the current task live in the CLI store (`useCLIStore().messages`, reset by `/new` and `/clear`).

## Design

- "The last answer" is the newest finished row that is an assistant text (say `text` or say `completion_result`,
  both `role: "assistant"`) or the `attempt_completion` row's `toolData.result`. Streaming rows are skipped.
- "The last code block" is the last fenced block (backticks or tildes, three or more, closed by the same character at
  least as long) of the newest answer that has one.
- Clipboard: OSC 52 (`ESC ] 52 ; c ; base64 BEL`), written with ink's `useStdout().write` like `/clear`'s screen wipe;
  under tmux wrapped in the `DCS tmux;` passthrough with doubled ESCs. A terminal cannot report whether it accepted the
  write, so the note always says what to do if the clipboard stays empty (tmux `set-clipboard on`, or `/export`). No
  native clipboard tools (pbcopy, xclip, wl-copy) are spawned: the task asked for OSC 52 plus a fallback message, and
  OSC 52 also works over SSH.
- Export: `# Tumble Code transcript` with time, mode and model, then `## You` / `## Tumble` sections, shell commands as
  `sh` blocks with `$ command` and output (fence longer than any backtick run inside), other tools one italic line,
  system notes as quotes; thinking is left out. Default file `<workspace>/tumble-export-YYYY-MM-DD-HHMMSS.md` (local
  time); `/export <file>` is resolved against the workspace, parent directories are created, and an existing file is
  never overwritten (`wx`), the note says so. The written path is printed as a system row.

Code: `apps/cli/src/ui/utils/transcriptExport.ts` (pure), commands in `lib/utils/commands.ts`, handlers in
`ui/hooks/useTaskSubmit.ts` (new options `workspacePath`, `model`; App passes the workspace and the live model).

## Tests

- `transcriptExport.test.ts` (11): last answer (completion vs text, streaming skipped, none), last code block (several
  answers, tildes, nested longer fence, none), OSC 52 plain and tmux, Markdown layout, fence length, default path.
- `useTaskSubmit.test.tsx` (+5): `/copy` writes the base64 OSC 52 through ink's stdout and a note, `/copy code`,
  nothing to copy, `/export` default file in the workspace with the path printed, `/export notes/chat.md` and no
  overwrite. `commands.test.ts` (+1). With App characterization and SlashCommandTrigger: 67 passed.

## Residuals

- OSC 52 payload limits differ per terminal (some cap around 100 kB); a very long answer may not arrive, the note then
  points at `/export`.
- The export covers the rows the CLI holds for the current task (after `/new` the earlier task is gone from the
  store); the extension's own task history is not read.
