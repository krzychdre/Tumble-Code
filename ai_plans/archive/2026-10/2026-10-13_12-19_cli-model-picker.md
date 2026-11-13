# CLI: pick the model from a list (`/model`)

Status: done on `feat/cli-model-picker` (cut from main 41125ab94, local only, not pushed).

Related plans: `2026-10-06_12-20_cli-model-switch.md` (the `/model` command and `ExtensionHost.switchModel`),
`2026-10-11_00-30_cli-model-connection.md` (a model's own connection, which a switch follows).

Touched:
`apps/cli/src/lib/utils/model-command.ts`, `apps/cli/src/lib/utils/commands.ts`,
`apps/cli/src/ui/components/ModelPicker.tsx` (new), `apps/cli/src/ui/hooks/useTaskSubmit.ts`,
`apps/cli/src/ui/hooks/useGlobalInput.ts`, `apps/cli/src/ui/stores/uiStateStore.ts`, `apps/cli/src/ui/App.tsx`,
`apps/cli/README.md`, tests (`model-command.test.ts`, `ModelPicker.test.tsx` (new), `useTaskSubmit.test.tsx`,
`useGlobalInput.test.tsx`).

## Need

`/model` without an argument only printed the models of `cli-settings.json`; the user then had to type
`/model <id>`. The owner wants it to work like the profile dropdown of the VS Code extension: pick the model
from a list.

## What was happening

- `useTaskSubmit.ts:270` (before): the `switchModel` action built one message. Without an argument it was
  `formatModelList(...)` (`model-command.ts:29`); with one it checked "already runs", "extension not started",
  then called `switchModel(mode, id)` and confirmed with `formatModelSwitched(...)`. The whole switch path
  lived inline in `handleSubmit`, so nothing else could reuse it.
- Typing is impossible while a request streams (`App.tsx` `InputArea isActive={!isLoading}`), so `/model` runs
  only between requests or while the task waits for an answer. A reply already streaming finishes on the old
  model (`ModeProfileBinding.applyCliProviderSettingsToCurrentMode`). The list keeps that: it is opened from the
  same prompt and switches through the same function.
- Overlays: `/mcp` sets `useUIStateStore.showMcpPanel`; `App.tsx` then hides the prompt (`inputActive`) and
  renders `McpPanel` in the tail; `useGlobalInput.ts` closes it on Esc so Esc does not cancel the task.
  Shift+Tab (`useGlobalInput.ts:94`) was held back only for an open autocomplete picker.

## Change

- Choice of infrastructure. The `#`/`/` pickers (`requestInput("#")` plus a trigger) are driven by text typed
  into the prompt: a trigger character, a debounced search, results that refilter on every key. A fixed, short
  list that must name its mode and close without a change on Esc fits that badly (a new trigger character, a
  "query" nobody types, Esc semantics of the autocomplete). So the list is an overlay opened like `/mcp`
  (store flag, prompt hidden, rendered in the tail), framed and titled like `McpPanel`, and its rows, keys,
  scrolling and pointer are the autocomplete's `PickerSelect`, so it looks and moves like the other pickers.
- `model-command.ts`: `buildModelRows(currentModel, models)` (every `models` entry in file order with
  `describeEntry`'s wording, plus the current model first when it has no entry, detail "no entry in models")
  and `hasOtherModel(rows)`.
- `ModelPicker.tsx`: title `Model for <mode> mode`, the current row marked with a bullet, opens on the current
  row, `↑↓ select · enter switch · esc close`. Enter reports the id (`onSelect`), Esc calls `onClose`.
  `isActive` is false while an approval, a follow-up or a password dialog is up, like `McpPanel`.
- `useTaskSubmit.ts`: the switch is now ONE function, `switchToModel(id)` ("already runs", "not started",
  `switchModel`, `formatModelSwitched`, "Could not switch the model: ..."). `/model <id>` calls it; the new
  `pickModel(id)` (returned by the hook, wired to the list's Enter) closes the list and calls it unless `id` is
  the model already running, which only closes. Whatever is added to the switch later (saving the choice to
  `cli-settings.json` is being added on another branch) reaches the list for free.
  `/model` without an argument opens the list when `hasOtherModel`, else prints `formatModelList` as before.
- `uiStateStore.ts`: `showModelPicker` / `setShowModelPicker`.
- `useGlobalInput.ts`: Shift+Tab does nothing while the list is open (the list is about the current mode, its
  title names it and Enter changes its model); Esc is left to the list and never cancels a task under it.
- `App.tsx`: `inputActive` is false while the list is open (no keys leak into the prompt), and the list
  renders next to the MCP panel.
- `commands.ts`: description "Pick the model of this mode from ~/.roo/cli-settings.json; /model <id> runs <id>
  in this mode". README: the `/model` paragraph with a drawing of the list; the shortcut table's Esc row,
  and its stale `Ctrl+M` row now says `Shift+Tab` (what `cycle-mode` matches since the Ctrl+M fix).

## Before / after

| Situation                                          | Before                                 | After                                                  |
| -------------------------------------------------- | -------------------------------------- | ------------------------------------------------------ |
| `/model` with entries in `models`                  | prints the list; type `/model <id>`    | list opens on the current model; arrows + Enter switch |
| Enter on the model in use                          | n/a                                    | list closes, nothing printed, nothing switched         |
| Esc in the list                                    | n/a                                    | list closes, no change; a task is not cancelled        |
| Shift+Tab with the list open                       | n/a                                    | ignored                                                |
| `/model` with no entries (or only the current one) | prints the list and how to add entries | same                                                   |
| `/model <id>`                                      | switches                               | unchanged, through the same function as the list       |

## Tests

- `model-command.test.ts`: rows in file order with the printed list's details, the current one marked; a
  current model without an entry comes first; `hasOtherModel` for no models, only the current one, none known.
- `ModelPicker.test.tsx` (ink-testing-library, as `McpPanel.test.tsx`): title, details, marker and initial
  highlight; a row for a model without an entry; arrows then Enter report the id; Enter at once reports the
  current id; Esc closes without a pick; inactive ignores every key.
- `useTaskSubmit.test.tsx`: `/model` opens the list without printing or switching; no choice prints the text
  list (`it.each`: no models, only the current one); `pickModel` produces exactly the typed command's
  confirmation and closes the list; the current model closes silently; a failed switch is reported the same way.
  The typed-command tests are kept.
- `useGlobalInput.test.tsx`: Shift+Tab cycles modes normally and does nothing with the list open; Esc with the
  list open does not cancel the running task.

## Notes

- No id autocomplete after `/model ` and no free-text row in the list: an id without an entry still needs
  `/model <id>`.
- The list does not watch `cli-settings.json`; it shows the `models` the session started with (as before).
- Ctrl+T can still open the TODO viewer over the list, as it can over the MCP panel.
- Saving: rebased onto `feat/cli-model-persist-per-mode` (#879), `switchToModel` awaits the `saved` promise of
  `ExtensionHost.switchModel`, so a pick from the list is saved in `cli-settings.json` exactly like `/model <id>`
  (test "switches and saves exactly like the typed command").
