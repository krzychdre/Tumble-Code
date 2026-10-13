# CLI: `/model` keeps its choice per mode in cli-settings.json

Status: done on `feat/cli-model-persist-per-mode` (local, stacked on `feat/cli-model-modes`, not pushed).
Related plans: `2026-10-13_12-17_cli-model-modes.md` (the `models.<id>.modes` lists this writes),
`2026-10-06_12-20_cli-model-switch.md` (`/model`), `2026-09-23_cli-settings-user-owned.md` (the rule "nobody but me
writes cli-settings.json", reversed here for `/model` only).
Touched: `apps/cli/src/lib/storage/mode-model.ts` (new), `apps/cli/src/lib/storage/index.ts`,
`apps/cli/src/agent/extension-host.ts`, `apps/cli/src/commands/cli/run.ts`, `apps/cli/src/ui/hooks/useExtensionHost.ts`,
`apps/cli/src/ui/hooks/useTaskSubmit.ts`, `apps/cli/src/lib/utils/model-command.ts`,
`apps/cli/src/lib/utils/commands.ts`, `apps/cli/README.md`, `ai_plans/2026-09-23_cli-settings-user-owned.md` (update
note), tests (`mode-model.test.ts`, `extension-host.test.ts`, `useTaskSubmit.test.tsx`, `run.test.ts`).

## Need

In VS Code a mode remembers the API profile chosen in it. In the CLI `/model <id>` lasted until the session ended, so
the owner had to edit the file by hand to keep a model in a mode. The owner decided (2026-10-13) that the CLI may now
write `~/.roo/cli-settings.json` for this, and only for this.

## What was happening

- `ExtensionHost.switchModel` (`apps/cli/src/agent/extension-host.ts:615` before) resolved and applied the new
  settings and documented "Nothing is written to cli-settings.json".
- `useTaskSubmit.ts:270-300` (before) parsed `/model <id>`, called `switchModel` and printed `formatModelSwitched`
  ("... for the rest of this session; ...").
- The only writer of the file was `saveSettings` (`lib/storage/settings.ts`), used by no run since the user-owned
  refactor; it rewrites whole top-level keys.

## Change

- `lib/storage/mode-model.ts`:
    - `setModeModel(file, mode, model)` changes a parsed file in place and returns the key: where `modes.<mode>.model`
      is set it is updated in place; otherwise `mode` is taken out of every other model's `models.X.modes` (an emptied
      list is dropped, and entry X only when that left it `{}`) and added to `models.<model>.modes` (creating `models`
      and the entry). A list that already has the mode keeps its order. In the first case the mode is also taken out of
      other models' lists: the same model in both places was allowed, and a list still naming the old model would stop
      the next run at startup.
    - `saveModeModel` reads the file under `withLockedJsonTransaction` (the lock and atomic writer behind
      `safeWriteJson`), applies `setModeModel` and writes only when the JSON changed. The atomic replace keeps the
      file's permission bits; a missing file is created with only the choice; unparsable JSON fails the save.
    - `createModelChoiceSaver({ providerFlags, ephemeral })` returns the function run.ts hands the host: under provider
      flags (the run ignores mode models) and under `--ephemeral` ("Run without persisting state", `main.ts:69`) it
      reports `session-only` with the reason; otherwise it saves and reports `saved` (path and key) or `failed`
      (path and error), never throwing.
- `ExtensionHostOptions.saveModelChoice`; `ExtensionHost.switchModel` returns `{ settings, saved }`: the switch is
  applied synchronously as before, then the saver is called once (a throwing saver becomes `failed`; without a saver
  the result is `session-only`). A switch that throws saves nothing. Any caller of the switch path (the TUI's
  `/model <id>`, the picker another branch adds) gets the save without parsing anything.
- `useTaskSubmit` awaits `saved` only for the message. `/model <id>` with the model already running stays a no-op
  before the host is reached, so nothing is written.
- Texts: `formatModelSwitched` ("... ; the next request goes to it. Saved in ~/.roo/cli-settings.json
  (models.Qwen3.8-27B.modes), so later sessions run it in code mode too." / "... for the rest of this session; ...
  Not saved: <reason>." / "... Saving it in <path> failed: <error>"), the list footer, the `/model` description,
  the host doc comment, README (the `/model` paragraph and the Settings File intro).

## Before / after

| Situation                                            | Before       | After                                                      |
| ---------------------------------------------------- | ------------ | ---------------------------------------------------------- |
| `/model Qwen3.8-27B` in code, owner's file           | session only | switch now + `models.Qwen3.8-27B.modes: ["code"]` saved    |
| same, file has `modes.code.model`                    | session only | switch now + `modes.code.model` updated in place           |
| later `/model GLM-5.3-NVFP4` in code                 | session only | `code` moves from Qwen's list (list dropped) to GLM's list |
| run with `--model`/`--provider`/... or `--ephemeral` | session only | session only, the message says why                         |
| write fails (EACCES, bad JSON)                       | n/a          | switch holds, the message names the error                  |
| file chmod 600                                       | n/a          | stays 600                                                  |
| `/model <current>`                                   | no-op        | no-op, nothing written                                     |

## Tests

- `mode-model.test.ts`: `setModeModel` (new list, created `models`/entry, moves out of other lists with the drop rules,
  existing list untouched, in-place `modes.<mode>.model` plus contradicting list removed, connection-only `modes`
  entry untouched, malformed shapes refused); the saver on a temp config dir: other keys and key order untouched,
  tabs, mode 600 kept, fresh re-read keeps an edit made between saves, a later choice moves the mode, an unchanged
  file is not rewritten, a missing file is created, bad JSON fails and is left as is, provider flags and
  `--ephemeral` save nothing.
- `extension-host.test.ts`: saver called once after the settings reach the extension, a throwing saver becomes
  `failed` with the switch kept, no saver means `session-only`, a failed switch saves nothing.
- `useTaskSubmit.test.tsx`: the three messages.
- `run.test.ts`: run hands the host a saver that writes the temp settings file, and session-only savers for
  `--model` and `--ephemeral` that leave the file byte-identical.

## Notes

- The file is rewritten with tab indentation by `safeWriteJson`'s writer; a hand-formatted file loses its own
  whitespace on the first save (content and key order stay).
- `/model` without an argument lists `models` as read at startup, so the modes it shows next to a model do not
  reflect a save made during the session.
- A choice made in a mode that ran a model through the top level (no binding) is still written as a list entry,
  also when `<id>` is the top-level model; the file then says explicitly what that mode runs.
- Mode slugs are written as the TUI names the active mode; nothing checks them against the known modes.
