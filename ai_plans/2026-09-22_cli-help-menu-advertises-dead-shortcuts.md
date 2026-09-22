# CLI: the "?" shortcuts menu advertises bindings that do not exist

**Date:** 2026-09-22
**Branch:** `fix/cli-help-menu-lies` (forked from `main` = `de6495c04`)
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

### 1. `tab to toggle focus`: the feature was deleted, the menu entry stayed

`useGlobalInput` documents the removal itself
(`apps/cli/src/ui/hooks/useGlobalInput.ts:33-35` before this change):

> Note: the scroll/input focus toggle (Tab) was removed with the ScrollArea
> component - the transcript now flows into native scrollback via `<Static>`,
> so there is no in-app scroll viewport to focus.

Nothing handles Tab as a focus switch any more. What Tab really does:

- with a picker open, `AutocompleteInput` accepts the highlighted item
  (`AutocompleteInput.tsx:220-236`, `key.return || key.tab`);
- with no picker open, `MultilineTextInput` swallows it
  (`MultilineTextInput.tsx:282-285`, `if (key.tab) return`).

So the entry named a capability that no longer exists while hiding the one Tab
actually has.

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
2. **Shift+Tab stays out of the picker's way.** Because Tab accepts the
   highlighted item, the cycle handler returns early while a picker is open, and
   `AutocompleteInput` now accepts on `key.return || (key.tab && !key.shift)` so
   one key press never means two things.
3. **`tab` is documented for what it does:** accept the highlighted suggestion.
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

## Scope boundary (deliberately not fixed here)

A fully portable newline (Claude Code's trailing-backslash continuation, which
needs no modifier at all) would remove the "in some terminals" caveat, but it is
a new input feature rather than a correction of a false claim, so it is not part
of this change.
