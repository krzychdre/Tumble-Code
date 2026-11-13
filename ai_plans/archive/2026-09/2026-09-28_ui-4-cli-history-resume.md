# UI plan §4 (CLI), part 4: Ctrl+R history search and the resume picker

Source: `ai_plans/2026-09-27_ui-modernization.md` §4, bullet "Ctrl+R reverse search over input history
(`useInputHistory` exists), an interactive resume picker, ...". Branch `feat/ui-4-cli-history-resume`, stacked on
`feat/ui-4-cli-status-line`. The same bullet's `/copy` and `/export` are split into `feat/ui-4-cli-copy-export`.

## What existed (verified)

- `useInputHistory` (`~/.roo/cli-history.json`, oldest first, up to 500) with Up/Down browsing only.
- Ctrl+R had no binding: `MultilineTextInput` inserted a literal `r` (ink reports `\x12` as `r` + ctrl).
- An interactive resume picker already exists: typing `#` opens `HistoryTrigger` (this workspace's tasks, fuzzy
  search, Enter resumes via `showTaskWithId`). It was only discoverable through the `?` help list, and it could not be
  opened at start-up (`-c` and `--session-id` resume without choosing).

So the resume part is about entry points, not a second picker.

## Change

- `ui/utils/reverseSearch.ts` (pure): `startReverseSearch`, `acceptQuery` (newest entry containing the query,
  case-insensitive), `searchOlder` (next older match, skipping entries equal to the shown one, since the history keeps
  repeats; with none left the match stays and the state is "failing", as in bash).
- `ReverseSearchPrompt.tsx`: renders `(reverse-i-search)'query': match` in place of the text input and owns the keys:
  typing and Backspace edit the query, Ctrl+R older, Enter/Tab/Right accept, Escape/Ctrl+G cancel. State changes go
  through functional `setState` updates, so fast keystrokes build on each other.
- `MultilineTextInput`: `onReverseSearch` prop; Ctrl+R (and kitty's `CSI 114;5u`) never types an `r` any more.
- `AutocompleteInput`: the search state; Enter puts the match into the prompt for editing (it does not send it; a
  second Enter does), Escape restores what was typed before Ctrl+R. New handle method `setValue(text)` that goes through
  the normal change path, so triggers fire.
- `/resume` global command (`openResumePicker`) and `tumble --resume`: both ask the UI store for input `"#"`
  (`requestInput`); App applies it through `setValue` once the input is active. `--resume` is rejected with `--print`,
  a prompt, `--session-id`, `--continue` or `--create-with-session-id`.
- `useAutocompleteTriggers` re-runs an open history search when the task history arrives (the picker opened by
  `--resume` can be up before the first state push).
- `?` help lists `ctrl + r`; README documents Ctrl+R and resuming.

## Tests

- `reverseSearch.test.ts` (7), `AutocompleteInput.reverseSearch.test.tsx` (5: narrow and older, Enter fills without
  sending, Escape restores, failing, `setValue`), `commands.test.ts` (+1), `useTaskSubmit.test.tsx` (+1), `run.test.ts`
  (+4: App prop, three rejected combinations), `HelpTrigger.test.tsx` (count 12 -> 13). With the other autocomplete,
  MultilineTextInput and App characterization specs: 168 passed.
- Real TUI in a pty (pexpect + pyte, worktree `tsx`, live `src/dist` read-only, isolated HOME with a seeded history):
  Ctrl+R `git` showed `git log --oneline`, Ctrl+R again `git status`, Enter left `git status` in the prompt;
  `--resume` started with `#` and the picker ("No task history found" in the ephemeral run); `/resume` reopened it.

## Residuals

- The search matches substrings, not fuzzy; multi-line entries are shown on one line with `⏎`.
- The slash picker accepts `/resume` into the prompt on the first Enter and runs it on the second, like every other
  command.
