# CLI slash picker swallows typing, so `/permissions` cannot be reached by typing

## Symptom

In the interactive CLI the user types `/permissions ask` (or `allow`) and Enter.
Nothing about permissions happens. Depending on timing the prompt instead ends
up holding `/new`, and submitting it wipes the current task.

## Root cause (proven with a pty capture, not inferred)

Driving the installed build `0.2.0-local.904048d42` through a pseudo terminal
(`/tmp/tumble_probe.py`, pexpect + pyte, 120x40) and typing one character every
30 ms gave this sequence:

| keys sent   | prompt afterwards | picker                                   |
| ----------- | ----------------- | ---------------------------------------- |
| `/`         | `/`               | opens, lists `/new`, `/permissions`, ... |
| `perm`      | `/`               | unchanged, still unfiltered              |
| Enter       | `/new `           | closes (accepted the FIRST item)         |
| `ask` Enter | (empty)           | `/new ask` ran the clearTask action      |

Every character typed after the `/` is lost. The reason is one prop in
`apps/cli/src/ui/App.tsx`:

```tsx
<InputArea isActive={!pickerState.isOpen && !isLoading} ... />
```

While the picker is open the whole input (`AutocompleteInput` and its
`MultilineTextInput`) is rendered inactive, so ink never delivers key presses to
it. The only component still listening is the `PickerSelect` that `App` renders
next to the input, and it understands Enter, Tab, the arrows and Escape only.
Type-to-filter, the thing the fuzzy `search()` in `SlashCommandTrigger` exists
for, is unreachable, and Enter accepts whatever is highlighted, which is `/new`
for a fresh `/`.

This is a regression from the Claude-Code-style redesign that landed with PR
#166 (`ce2c52c9c`). Before it, `App.tsx` rendered the input with
`isActive={isInputAreaActive}` (no picker clause) and the picker with
`isActive={isInputAreaActive && pickerState.isOpen}`, so typing kept flowing
into the input while the dropdown was open. The redesign added the
`!pickerState.isOpen` clause, and yesterday's help-menu fix
(`ai_plans/2026-09-22_cli-help-menu-advertises-dead-shortcuts.md`) documented
the consequence for Tab and worked around it inside `PickerSelect` instead of
removing the clause.

The `/permissions` command itself is fine: `useTaskSubmit.handleSubmit` parses
it, sends the `updateSettings` profile and flips the session mode; the user
simply could never submit that text.

### Second defect visible in the same capture: the dropdown overdraws the input

The pty frame after `/` had skill descriptions wrapped over four rows each,
running through the bordered input box and the footer. Two causes in
`PickerSelect.tsx`:

1. Every trigger's `renderItem` renders one `<Text>` with the default
   `wrap="wrap"`, and the skill descriptions the extension reports are several
   hundred characters long, so one item takes 3-5 rows.
2. The results column is a `<Box height={maxVisible}>` (8) while its content is
   up to `maxVisible` items PLUS the `↑ n more` / `↓ n more` indicator rows, and
   ink does not clip overflow unless asked to. The surplus rows are drawn over
   whatever sits below the picker, which is the input box.

### Third defect, found by the new test: the picker's key handler runs one render late

With the input active again, the first version of the `AutocompleteInput`
test still failed deterministically: `/perm`, wait for the list to filter,
Enter, and nothing was accepted. Logging inside `PickerSelect`'s handler showed
it running with `results.length === 0` although the frame already displayed
the filtered row. ink swaps the `useInput` handler in a passive effect, which
React flushes after the commit, so a key press that arrives right after the
debounced search delivered its results (or right after the highlight moved)
runs the closure of the previous render. In a terminal this is the fast-typing
case: results arrive, Enter lands before the effect flushed, and either nothing
or the previously highlighted item gets accepted. `MultilineTextInput` already
reads its value and cursor through refs for exactly this reason ("Read from
refs to get the latest values, not stale closure captures"); `PickerSelect`
did not.

## Fix

1. `App.tsx`: the input is active whenever no dialog owns it and nothing is
   loading; an open picker no longer deactivates it. Typing filters the list
   again and the cursor stays visible, as in Claude Code.
2. Key ownership while the picker is open, so re-activating the input does not
   double-handle anything:
    - `PickerSelect` keeps Enter, Tab, Up, Down and Escape.
    - `AutocompleteInput` drops its own Enter/Tab `useInput` (it would accept
      the item a second time through the same `handleItemSelect`); its submit
      path already ignores Enter while a picker is open, and its history hook
      is already inactive then.
    - `MultilineTextInput` gets `lineNavigationActive`; `AutocompleteInput`
      passes `!pickerState.isOpen` so Up/Down do not also move the cursor
      between lines of a multi-line prompt while they move the highlight.
    - Escape reaches both (`PickerSelect.onEscape` and the input's
      `handleEscape`); both only close the picker, which is idempotent.
3. `PickerSelect`: each row is `height={1} overflow="hidden"`, and the column
   uses `minHeight` instead of `height`, so the indicator rows extend the box
   instead of overflowing it. Its key handler reads `results` and
   `selectedIndex` through refs that are refreshed during render, so Enter,
   Tab and the arrows always act on what is on screen.
4. Every trigger's row `<Text>` gets `wrap="truncate-end"`, so a long
   description ends in `…` instead of being clipped mid-word by the row.

Not changed on purpose: `/permissions` still needs the picker closed, i.e.
`/permissions` + Enter accepts the item, then Enter again shows the help. That
matches every other command with arguments and is how the user reaches
`/permissions ask`. The input also stays inactive while a task is streaming
(`isLoading`), so the policy can only be switched between turns; the plan of
2026-08-08 promised an in-flight switch, but that would need input queuing that
this TUI does not have.

## Verification

- New `AutocompleteInput` tests: typing after `/` filters the picker, Enter
  while it is open does not submit, `/permissions ask` + Enter submits the full
  line.
- `PickerSelect` tests: the `↓ n more` row stays inside the frame with
  `maxVisible` items; a 300-character description occupies one row and the next
  item starts on the next row.
- `SlashCommandTrigger` test: a long description renders on one line ending in
  `…`.
- Focused suites, full CLI suite, `tsc --noEmit`, eslint, knip.
- pty probe against the rebuilt `apps/cli/dist` with the installed extension
  bundle: typing `/perm` filters to `/permissions`, Enter + `ask` + Enter prints
  `Permissions: asking before actions for this session.`.

### Result (2026-09-22)

704 CLI tests pass, `tsc`, `eslint` and `knip` exit 0. The pty run
(`/tmp/tumble_probe.py`, 120x40, one key every 30 ms, `node apps/cli/dist/index.js`
with `ROO_EXTENSION_PATH=~/.roo/cli/extension`):

| keys   | prompt             | picker / transcript                                    |
| ------ | ------------------ | ------------------------------------------------------ | -------------------- |
| `/`    | `/`                | seven rows, every description clipped to one row       |
| `perm` | `/perm`            | one row: `/permissions <ask                            | allow> - Change ...` |
| Enter  | `/permissions `    | closed                                                 |
| `ask`  | `/permissions ask` | closed                                                 |
| Enter  | (empty)            | `Permissions: asking before actions for this session.` |
| `/`    | `/`                | reopens under the system message, input box intact     |

Against the installed pre-fix build the same `/` shows the redmine skill
description wrapped over three rows into the input area, as in the original
report.

Probe artefact, not a defect: pyte drops the text that follows the `⚙️` icon
(U+2699 + U+FE0F), so the `/new` and `/permissions` rows appear without their
names in the dump. The installed build shows the same, and ink-testing-library
renders `⚙️ /new - Start a new task` in full for the exact same JSX.
