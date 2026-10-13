# CLI: a model names the modes that run it (`models.<id>.modes`)

Status: done on `feat/cli-model-modes` (local, from main 41125ab94, not pushed).
Related plans: `2026-10-06_12-20_cli-model-switch.md` (`/model`), `2026-10-11_00-30_cli-model-connection.md` (a model's
own connection), `2026-09-23_cli-per-mode-provider-settings` (the `cliModeProviderSettings` mechanism).
Touched: `apps/cli/src/types/types.ts`, `apps/cli/src/lib/utils/model-settings.ts`,
`apps/cli/src/lib/utils/model-command.ts`, `apps/cli/src/commands/cli/run.ts`, `apps/cli/README.md`,
`apps/cli/examples/cli-settings.example.json`, `apps/cli/examples/README.md`, tests
(`model-settings.test.ts`, `model-command.test.ts`, `run.test.ts`, `settings-example.test.ts`).

## Need

The owner: "one model could have multiple modes defined". With several modes on one model, `modes` repeated the
same `{ "model": "<id>" }` once per mode, far from the model's own entry. The owner's file has no `modes` section at
all, only `models`. The binding should be writable where the model is described:
`"Qwen3.8-27B": { "reasoningEffort": "xhigh", "modes": ["code", "debug"] }`.

## What was happening

- `run.ts:280-294` (before) built `modeProviderConfigs` from `settings.modes` only; `resolveForModel` (`run.ts:310`)
  read `settings.modes?.[mode]` for /model; the startup validation labels were `modes.<slug>` (`run.ts:424`).
- `findModelSettingsProblems` (`model-settings.ts`) knew no `modes` key; `listSetModelSettings` would have reported
  it as "ignored with the X provider", since it is not in `ANY_PROVIDER_KEYS`.
- The core needs nothing: it already applies `modes[mode] ?? base` of `cliModeProviderSettings` on every mode switch,
  subtask and resume (`src/core/webview/ModeProfileBinding.ts`). A binding only has to land in `modes` of that
  message.

## Change

- `CliModelSettings.modes?: string[]`.
- `getEffectiveModeSettings(settings)` (`model-settings.ts`): every `modes` entry as written, plus for each slug a
  `models.<id>.modes` list names, `model: <id>` added to the slug's entry (created when missing; a written
  `modes.<slug>.model` wins). Each entry carries a label: `modes.<slug>`, `models.<id>.modes`, or
  `modes.<slug> and models.<id>.modes`. It never throws on a malformed file (validation runs later in `run.ts`).
- `run.ts` uses it for `modeProviderConfigs`, `resolveForModel` and the startup validation labels; the misplaced
  `reasoningEffort` warning already looked its model up in `modeProviderConfigs`, so it sees the bindings. Under
  provider flags `modeProviderConfigs` stays `{}` and `resolveForModel` takes no mode layer, so the bindings are
  dropped exactly like `modes`.
- Validation, error + exit 1 like the other settings problems: `findModelSettingsProblems` requires `modes` to be a
  list of non-empty strings; `findModeBindingProblems(settings)` reports a slug listed by two different models
  (names both lists) and a slug listed in `models.X.modes` while `modes.<slug>.model` names Y (names both places).
  The same model in both places, and repeats inside one list, pass.
- `modes` joins `ANY_PROVIDER_KEYS`, so it never shows up in the "ignored with the X provider" warning.
- `/model` without an argument lists an entry's modes among its details (`describeEntry`).
- README: a paragraph and example under "Settings per mode". The example settings file now binds `debug` through
  `models.Qwen3.8-4B.modes` instead of `modes.debug`, and `examples/README.md` explains the key.

## Before / after

| Settings file                                                  | Before                                                                    | After                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `"Qwen3.8-27B": { "modes": ["code", "debug"] }`                | `modes` ignored (and named in the openai-only warning on other providers) | `code` and `debug` run Qwen3.8-27B: at startup, on mode switches, in subtasks, on resume |
| `modes.debug: { baseUrl: X }` + `Qwen3.8-27B.modes: ["debug"]` | debug ran the top-level model on X                                        | debug runs Qwen3.8-27B on X                                                              |
| `debug` listed by two models                                   | n/a                                                                       | startup error naming both lists                                                          |
| `modes.debug.model: GLM` + `Qwen.modes: ["debug"]`             | n/a                                                                       | startup error naming both places                                                         |
| any binding + `--base-url`                                     | n/a                                                                       | ignored for the run, like `modes`                                                        |
| broken connection for a listed mode                            | n/a                                                                       | startup error labelled `models.<id>.modes in <path>`                                     |

## Tests

- `model-settings.test.ts`: `getEffectiveModeSettings` (empty, as written, created entries, merged entry and label,
  malformed input), `findModeBindingProblems` (fine cases, two models, conflict with `modes.<slug>.model`), the
  `modes` type check, `listSetModelSettings` skipping `modes`.
- `model-command.test.ts`: the list names an entry's modes.
- `run.test.ts` ("a model that names its modes"): startup and per-mode settings with the model's effort and own
  connection, a connection-only `modes` entry gets the model, /model keeps the mode's layers, provider flags drop
  the bindings, a broken listed mode is labelled `models.<id>.modes`, conflict and malformed list exit 1, no ignored
  warning for `modes`.
- `settings-example.test.ts`: the example file has no binding problems.

## Notes

- Mode slugs are not checked against the known modes: an unknown slug is as harmless as an unknown `modes` key.
- When the session starts in a listed mode whose connection is broken, the error has no label, as before for a
  `modes` entry (the start configuration is always checked unlabelled).
- The settings file is still never written by the CLI on this branch; `feat/cli-model-persist-per-mode` (stacked)
  makes `/model` save its choice here.
