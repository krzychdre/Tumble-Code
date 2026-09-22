# CLI: the "?" shortcuts menu advertises bindings that do not exist

**Date:** 2026-09-22
**Branch:** `fix/cli-help-menu-lies`, stacked on
`fix/cli-skills-missing-in-slash-picker` (`1459202ea`), which itself forks from
`main` (`de6495c04`). The stacking exists so a local build carries the skills fix
that the installed CLI is already built from; the files the two branches touch do
not overlap.
**Status:** implemented

Writing and coding rule for every implementer of this plan: never use an em dash
or an en dash anywhere (code, comments, tests, commit messages, UI strings). Use a
hyphen, a comma, a colon or parentheses. Existing files still contain em dashes in
old comments; do not add new ones and do not rewrite old ones outside the lines
you touch.

## Problem

The user reports that the CLI's `?` menu "does not tell the truth" and names two
suspects: the focus toggle and mode cycling. The menu is a static list in
`apps/cli/src/ui/components/autocomplete/triggers/HelpTrigger.tsx`, and before
this change it promised ten bindings:

```
/           for commands
@           for file paths
!           for modes
#           for task history
shift + ⏎   for newline
tab         to toggle focus
ctrl + m    to cycle modes
ctrl + t    to view TODO list
ctrl + o    to expand tool output and thinking
ctrl + c    to quit
```

Two of those cannot work, one is misleading, and three real bindings are missing.

## Root cause (proven, not inferred)

### 1. `tab to toggle focus`: the feature was deleted, and Tab did nothing at all

`useGlobalInput` documents the removal itself
(`apps/cli/src/ui/hooks/useGlobalInput.ts:33-35` before this change):

> Note: the scroll/input focus toggle (Tab) was removed with the ScrollArea
> component - the transcript now flows into native scrollback via `<Static>`,
> so there is no in-app scroll viewport to focus.

Reading the code suggests Tab at least accepts the highlighted picker item,
because `AutocompleteInput` handles `key.return || key.tab`
(`AutocompleteInput.tsx:220-236`). In the running CLI it does not, and the pty
probe below proved it: with the slash picker open, Tab left the prompt at `/`
while Enter turned it into the accepted `/new`. Both the old installed build
(`0.2.0-local.88f5e3e38`) and the current source behave the same, so this is not
a regression introduced here.

The reason is one line in `App.tsx:594`: while the picker is open the input area
is rendered with `isActive={!pickerState.isOpen && !isLoading}`, i.e. `false`.
`AutocompleteInput`'s own `useInput` is registered with
`{ isActive: isActive && pickerState.isOpen }`, which is therefore always
`false` - ink never calls it. Acceptance is done exclusively by the
`PickerSelect` that `App` renders next to the input, and that component handled
only Enter, arrows and Escape. `MultilineTextInput`'s `if (key.tab) return` is
equally unreachable in that state, so with the picker open or closed Tab was a
no-op everywhere.

So the entry named a capability that no longer exists, and the capability a
reader of the code would expect instead was not wired up either.

### 2. `ctrl + m to cycle modes`: a terminal cannot send Ctrl+M

This is not a wiring bug, it is a protocol impossibility. A terminal encodes
Ctrl plus a letter as the letter's ASCII code masked with `0x1f`. For `M` that is
`0x4d & 0x1f = 0x0d`, the carriage return: the exact byte Enter sends. There is
no separate Ctrl+M event to listen for.

ink then resolves that byte before it ever considers the Ctrl branch
(`node_modules/.../ink/build/parse-keypress.js:145-182`): `s === '\r'` is tested
first and sets `name = 'return'`, leaving `ctrl = false`; the `ctrl+letter`
branch (`s.length === 1 && s <= '\x1a'`) is only reached for bytes that are not
CR. `use-input.js:66` then computes `input = keypress.ctrl ? keypress.name :
keypress.sequence`, so the handler receives `input = "\r"`, `key.return = true`,
`key.ctrl = false`.

The matcher in `apps/cli/src/lib/utils/input.ts` required the impossible state:

```ts
if (key.ctrl && input === "m") return true
```

Its fallback paths were dead too. They decode the kitty keyboard protocol
(`ESC [ 109 ; 5 u`), but that encoding is opt-in: the application has to push
the progressive-enhancement flags with `CSI > 1 u` first. Nothing in the CLI or
in ink 6.6.0 ever writes that sequence (grep for `\x1b[>` in `apps/cli/src` and
for `>1u` in ink's build output: no hits), so no terminal sends the CSI u form.

Net effect: pressing Ctrl+M in the prompt submitted the prompt, and the mode
cycling feature had never been reachable at all.

The unit test suite hid this. `input.test.ts` built its own `Key` object with
`{ ctrl: true }` and `input = "m"`, a combination ink cannot produce for Ctrl+M,
so the test passed while the binding was dead.

### 3. `shift + ⏎ for newline`: true only in a minority of terminals

`MultilineTextInput` accepts several encodings for a modified Enter
(`MultilineTextInput.tsx:251-274`). The portable one is ESC+CR, which is what a
terminal sends for Alt+Enter (and for Option+Enter on macOS with Option as
Meta): ink strips the leading ESC in `use-input.js:72-74`, so the handler sees
`input = "\r"` with `key.return = false`, which is the first branch of
`isModifiedEnter`. Shift+Enter, in contrast, is plain CR in a default terminal
and only becomes distinguishable (`ESC [ 13 ; 2 u`) when the user has turned on
kitty keyboard protocol or CSI u reporting by hand. The component's own header
comment already said as much ("Alt+Enter ... works reliably", "Shift+Enter ...
requires terminal support"); only the help menu claimed otherwise.

### 4. Three real bindings were undocumented

`esc` (interrupt a running task in `useGlobalInput.ts:141-149`, clear the prompt
through `AutocompleteInput.handleEscape`), `↑`/`↓` at the first/last line
(prompt history via `useInputHistory`), and the fact that `ctrl + c` needs two
presses (`useGlobalInput.ts:159-178`).

## Fix

The menu must describe reality, so each entry was either corrected or backed by
a binding that really works.

1. **Mode cycling moves to Shift+Tab.** Terminals send "backtab" (`ESC [ Z`) for
   it, which ink parses through its `keyName['[Z'] = 'tab'` plus `isShiftKey`
   table into `key.tab && key.shift` with an empty `input`. No opt-in protocol,
   works in xterm, gnome-terminal, konsole, kitty, wezterm, alacritty and the VS
   Code terminal, and it matches the Claude-Code-style muscle memory the rest of
   this TUI follows. The registry entry is renamed from `ctrl-m` to `cycle-mode`;
   the kitty CSI u form is kept as `ESC [ 9 ; 2 u` for users who enabled that
   encoding themselves.
2. **Tab really accepts the highlighted item now.** The handling moved into
   `PickerSelect`, the component that actually receives key presses while the
   picker is open, next to the existing Enter branch and guarded with
   `!key.shift`. The unreachable branch in `AutocompleteInput` keeps the same
   guard so the two cannot disagree if that component is ever made active again.
3. **Shift+Tab stays out of the picker's way.** The cycle handler returns early
   while a picker is open and `PickerSelect` ignores Shift+Tab, so one key press
   never means two things.
4. **Newline is advertised as `alt + ⏎`** with "shift + ⏎ in some terminals" in
   the description, which is exactly what the code supports.
5. **`esc`, `↑ / ↓` and "ctrl + c twice"** are added, so the menu covers every
   binding the input layer implements.
6. **`getReplacementText` is inverted.** It used to clear the input for a
   hardcoded list of action keys and insert `item.shortcut` for everything else,
   which meant a new entry would silently type its label ("shift + tab") into the
   prompt. Now only the four trigger characters are insertable and everything
   else clears, so the next entry added cannot regress that way.

Resulting menu:

```
/            for commands
@            for file paths
!            for modes
#            for task history
tab          to accept the highlighted suggestion
shift + tab  to cycle modes
alt + ⏎      for newline (shift + ⏎ in some terminals)
↑ / ↓        to browse previous prompts
ctrl + t     to view TODO list
ctrl + o     to expand tool output and thinking
esc          to interrupt the task, or clear the input
ctrl + c     twice to quit
```

## Tests

- `input.test.ts`: the registry entry is `cycle-mode`; Shift+Tab matches in both
  the backtab and the CSI u encoding; plain Tab does not match (the picker owns
  it); and, as the regression test for this bug, the event a terminal really
  produces for Ctrl+M (`input = "\r"` with `key.return`) must not match any
  global sequence.
- `HelpTrigger.test.tsx`: the list contains all twelve entries; it asserts that
  no entry advertises `ctrl + m` or the word "focus" any more; the `mode` entry's
  label is cross-checked against `isGlobalInputSequence` so the advertised key
  and the handled key cannot drift apart again; and every non-character entry
  clears the prompt instead of inserting its label.
- `PickerSelect.test.tsx` (new): Enter and Tab both accept the highlighted item,
  Shift+Tab accepts nothing.

## Verification in a real terminal

Unit tests cannot catch this class of bug, because a test can hand a handler any
`Key` object it likes, including combinations a terminal never produces (that is
exactly how the old Ctrl+M test passed). Everything above was therefore checked
end to end in a pty: `script -qfec "node <cli> -e ~/.roo/cli/extension -w <ws> -a
-k dummy" /dev/null` driven from a Node parent that writes raw bytes into the pty
and reads the frames back (`/tmp/help-menu-probe/probe.mjs` in the session that
produced this plan; `/tmp` is ephemeral, so recreate it from this description).

Results, old installed build vs the rebuilt CLI:

| key press (bytes)      | old build                      | after this change                  |
| ---------------------- | ------------------------------ | ---------------------------------- |
| Ctrl+M (`0x0d`)        | prompt submitted, task started | unchanged (it is Enter)            |
| Shift+Tab (`ESC [ Z`)  | nothing                        | `Switched to ❓ Ask`, footer `ask` |
| Tab, picker open       | nothing, prompt stays `/`      | prompt becomes the accepted `/new` |
| Shift+Tab, picker open | nothing                        | nothing, mode unchanged            |

A separate ink-only probe confirmed what ink reports for each key: Tab arrives as
`flags=[tab]`, Shift+Tab as `flags=[shift,tab]`, and Ctrl+M as `input=[0d]
flags=[return]` with no `ctrl` flag, which is the mechanical proof that Ctrl+M
and Enter are one and the same event.

Two side observations worth keeping:

- Right after startup the first Shift+Tab can be a silent no-op, because the
  mode list arrives from the extension asynchronously and the handler requires at
  least two modes. Pressing it once the session has settled always cycles. The
  same guard applied to the old Ctrl+M binding, so this is not new.
- `~/.roo/cli-settings.json` is shared by every CLI session on the machine. While
  these probes ran, a parallel session rewrote it to `provider: openai-codex`
  while leaving the `baseUrl` key behind, and in that state every plain `tumble`
  run aborts at startup with "Provider 'openai-codex' does not support a base
  URL". That is a separate defect (the base-url clear in `run.ts` is skipped when
  a run exits early, and concurrent read-modify-write of the settings file has no
  locking), unrelated to the help menu.

## Scope boundary (deliberately not fixed here)

A fully portable newline (Claude Code's trailing-backslash continuation, which
needs no modifier at all) would remove the "in some terminals" caveat, but it is
a new input feature rather than a correction of a false claim, so it is not part
of this change.
