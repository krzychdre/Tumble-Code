# CLI: the mode-switch notice names the model

Status: done on `feat/cli-mode-switch-shows-model` (local only, cut from main 41125ab94, not pushed).

Related plans: `2026-10-06_12-20_cli-model-switch.md` (/model), `2026-10-11_00-30_cli-model-connection.md`
(connection per model). A parallel branch adds `models.<id>.modes` and edits `ExtensionHost.switchModel` and the
/model block of `useTaskSubmit.ts`; this branch leaves both alone.

Touched:

- `apps/cli/src/agent/extension-host.ts`
- `apps/cli/src/ui/hooks/useExtensionHost.ts`
- `apps/cli/src/ui/hooks/useGlobalInput.ts`
- `apps/cli/src/ui/hooks/usePickerHandlers.ts`
- `apps/cli/src/ui/utils/modeSwitchNotice.ts` (new)
- `apps/cli/src/ui/App.tsx`
- `apps/cli/src/agent/__tests__/extension-host.test.ts`
- `apps/cli/src/ui/hooks/__tests__/useGlobalInput.test.tsx`
- `apps/cli/src/ui/hooks/__tests__/usePickerHandlers.test.tsx` (new)
- `apps/cli/README.md`

## Need

Each mode can run its own model (`modes.<slug>.model` in `cli-settings.json`, `/model` for the session). The owner
wants to see that the model changes along with the mode. Switching with Shift+Tab showed only `Switched to Architect`,
and choosing a mode in the `!` picker showed nothing at all.

## What was happening

- Shift+Tab: `useGlobalInput.ts:120` sent `{ type: "mode" }` and toasted `Switched to ${nextMode.name}`.
- `!` picker: `usePickerHandlers.ts:75` sent `{ type: "mode" }` and closed the picker, no notice.
- The model of a mode lives only in the host: `ExtensionHost.options.modeProviderSettings` (`{ base, modes }`, built in
  `run.ts`, replaced per mode by `switchModel`). The extension applies `modes[mode] ?? base` on a switch
  (`src/core/webview/ModeProfileBinding.ts:240`), so the same lookup on the host's copy gives the model the new mode
  will run with before the extension has even answered.
- Model-driven switches (the `switch_mode` tool) print the tool row `Switch Mode(architect)` / `Switching to
architect mode` (`ModeTool.tsx:26`). A subtask in another mode prints its new_task row. Neither names a model, and
  neither shows a toast.
- Footer: after every switch (user, model or subtask) the extension pushes state with the new `apiConfiguration`
  (`ModeProfileBinding.ts:242`), the transcript reducer forwards it (`transcript-reducer.ts:850`) and the footer reads
  it through `summarizeProviderSettings` (`App.tsx:137`). The footer already shows the right model; nothing to fix.

## Change

- `ExtensionHost.getModelForMode(mode)` (next to `switchModel`, also on `ExtensionHostInterface`):
  `summarizeProviderSettings(modes[mode] ?? base)?.model` over the host's current `modeProviderSettings`, so /model
  changes of this session count and the model is read from the provider's own field. Undefined without per-mode
  settings.
- `useExtensionHost` exposes it as a stable callback over the host ref, like `switchModel`.
- `modeSwitchNotice(modeName, model)` builds the text: `Switched to Architect (GLM-5.3-NVFP4)`, or the old
  `Switched to Architect` without a model.
- `useGlobalInput` and `usePickerHandlers` take an optional `getModelForMode` and use the notice; the picker now
  toasts on a mode choice too. `App.tsx` passes the callback to both.

## Before / after

| Action                                       | Before                   | After                                   |
| -------------------------------------------- | ------------------------ | --------------------------------------- |
| Shift+Tab to Architect                       | `Switched to Architect`  | `Switched to Architect (GLM-5.3-NVFP4)` |
| `!` picker, choose Architect                 | no notice                | `Switched to Architect (GLM-5.3-NVFP4)` |
| Same after `/model Qwen3.8-27B` in Architect | `Switched to Architect`  | `Switched to Architect (Qwen3.8-27B)`   |
| No per-mode settings / model                 | `Switched to Architect`  | `Switched to Architect` (unchanged)     |
| Model calls switch_mode                      | tool row, footer updates | unchanged (see Notes)                   |

## Tests

- `extension-host.test.ts` `getModelForMode`: mode entry wins over base, other modes fall back to base, `/model`
  (switchModel) is reflected, undefined without per-mode settings.
- `useGlobalInput.test.tsx` `shift+tab`: real Shift+Tab bytes (`ESC [ Z`) send the next mode and toast the notice with
  the model; without a model the old text.
- `usePickerHandlers.test.tsx` (new): choosing a mode in the picker sends it and toasts the notice; without a model the
  old text.

## Notes

- Model-driven switches and subtasks get no new notice. The transcript already has a row for them, and the footer
  updates with the new model. A toast would have to tell a model's switch from the user's own (whose toast is already
  shown before the extension confirms), which needs state shared by App, both hooks and the state push; more than a
  small change. Naming the model in the `Switch Mode` row is also wrong for a printed row: ctrl+o reprints rows with
  the lookup of the moment, so after a later /model the old row would show the new model.
- The notice reads the host's copy, not the extension's answer: it is shown at once, before the state push. Both use
  the same `modes[mode] ?? base`, so they agree.
- Ctrl+M no longer cycles modes (terminals cannot send it, see `lib/utils/input.ts`); Shift+Tab is the only key.
- The picker still allows a mode switch while a task runs (Shift+Tab refuses); unchanged here.
