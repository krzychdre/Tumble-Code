# CLI: say per model whether it can see images

Status: done on `feat/cli-model-supports-images` (local, cut from main 697b16768, not pushed).

Related plans: `ai_plans/2026-10-06_12-20_cli-model-switch.md`, `ai_plans/2026-10-11_00-30_cli-model-connection.md`;
the parallel branch that makes `vision` a built-in mode (the "eyes" for text-only models).

Touched:

- `apps/cli/src/types/types.ts` (`CliModelSettings.supportsImages`)
- `apps/cli/src/lib/utils/model-settings.ts` (`MODEL_SWITCH_KEYS`, header comment)
- `apps/cli/src/lib/utils/provider-config.ts` (`applyModelSettings`, doc comments)
- `apps/cli/src/lib/utils/model-command.ts` (`describeEntry`: "text only")
- `apps/cli/src/commands/cli/run.ts` (comment of the ignored-keys warning)
- `apps/cli/README.md` (`/model` list, settings table, new "Text-only models" section)
- `apps/cli/examples/cli-settings.example.json`, `apps/cli/examples/README.md`
- tests: `apps/cli/src/lib/utils/__tests__/{provider-config,model-settings,model-command}.test.ts`,
  `src/core/webview/__tests__/ModeProfileBinding.findImageCapableModes.spec.ts`

## Need

The owner runs text-only GLM-5.3 models on the `openai` provider (any OpenAI-compatible server) and wants a `vision`
mode on Qwen3.8-27B to look at images for them. That needs the CLI to tell the extension which models are text-only:

```json
"GLM-5.3-NVFP4": { "contextWindow": 262144, "supportsImages": false },
"Qwen3.8-27B": { "contextWindow": 262144, "supportsImages": true, "modes": ["vision"] }
```

## What was happening

- `openAiModelInfoSaneDefaults` has `supportsImages: true` (`packages/types/src/providers/openai.ts:455-462`). The
  openai handler reports `openAiCustomModelInfo ?? openAiModelInfoSaneDefaults` (`src/api/providers/openai.ts:703-708`,
  `resolveOpenAiModel`, also the registry's `resolveModel` at `src/api/runtime-provider-registry.ts:172`, which
  `resolveProviderModel` at `src/api/index.ts:179` calls).
- The CLI wrote `openAiCustomModelInfo` only from `contextWindow`, the four prices and a reasoning effort, else `null`
  (`apps/cli/src/lib/utils/provider-config.ts:320` before the change). No key could set `supportsImages`, so every
  openai model in the CLI counted as seeing images.
- Consequences in the core, all reading `info.supportsImages` of the model that runs:
    - `read_file` of an image: `ReadFileTool.readEntries` takes `task.api.getModel().info.supportsImages`
      (`src/core/tools/ReadFileTool.ts:173`); `handleBinaryFile` passes it to `validateImageForProcessing`
      (`ReadFileTool.ts:455-462`), which returns the "unsupported_model" notice only when it is false
      (`src/core/tools/helpers/imageHelpers.ts:145-150`). The final tool result drops images again for a text-only model
      (`ReadFileTool.ts:726-727`). With `true` the image bytes went to GLM, and the notice that names a vision mode
      (`imageHelpers.ts:108-132`) was never produced.
    - The `read_file` tool description advertises image reading only when `supportsImages` is set
      (`src/core/task/build-tools.ts:159-166`, `src/core/prompts/tools/native-tools/read_file.ts:22-27`); it is rebuilt
      per request, so it follows a mode switch.
    - History: `maybeRemoveImageBlocks` (`src/api/transform/image-cleaning.ts:8-24`, called per request at
      `src/core/task/TaskApiLoop.ts:1467` and in condensing at `src/core/condense/summarize.ts:350`) replaces image
      blocks with "[Referenced image in conversation]" for a model without `supportsImages`. So images from an earlier
      vision turn never reach GLM after a switch back.
    - `findImageCapableModes` (`src/core/webview/ModeProfileBinding.ts:470-497`) resolves each mode's settings with
      `resolveProviderModel` and keeps those with `info.supportsImages`. In the CLI every mode resolves to source `cli`,
      i.e. `modes[mode] ?? base` (`ModeProfileBinding.ts:154-157`, `resolve` at 165-169). The CLI fills `modes` from
      `modes.<slug>` and `models.<id>.modes` alike (`getEffectiveModeSettings`, built into `modeProviderSettings` at
      `apps/cli/src/commands/cli/run.ts:522-543`), and `base` from the top level. With the defaults every mode was
      listed, so even a correct notice would have named text-only modes.
- User-attached images in the TUI: the TUI has no image attachment. It sends text only (`askResponse` at
  `apps/cli/src/ui/hooks/useTaskSubmit.ts:376-380`, `newTask` via `ExtensionHost.runTask` at
  `apps/cli/src/agent/extension-host.ts:780-781`). The `@` picker inserts `@/path` mentions
  (`apps/cli/src/ui/components/autocomplete/triggers/FileTrigger.tsx:124-127`). On the extension side
  `resolveIncomingImages` (`src/core/webview/messageHandlers/context.ts:50-64`) turns an image mention into an attached
  image without passing `supportsImages` (so the default `true` at `src/core/mentions/resolveImageMentions.ts:65`
  applies), and the mention's text block says "Binary file omitted from context" (`src/core/mentions/index.ts:293-300`).
  The attached image is then stripped by `maybeRemoveImageBlocks` before a text-only model sees it.

## Change

- `models.<id>.supportsImages: boolean` in `CliModelSettings`.
- Validation: it joins `MODEL_SWITCH_KEYS`, so anything but `true`/`false` stops the run with
  `models.<id>.supportsImages must be true or false, got ...`.
- `applyModelSettings`: for the openai provider `supportsImages` is one of the configured keys laid over
  `openAiModelInfoSaneDefaults`, so an entry setting only `supportsImages` produces an `openAiCustomModelInfo` (it was
  `null` without a size, price or effort). Unset keeps `null` or the defaults' `true`. Since it is written on every
  start and on `/model` (`withModel` goes through the same function), a text-only flag of the previous model never
  outlives it.
- Other providers: `supportsImages` is not in `ANY_PROVIDER_KEYS`, so `listSetModelSettings` reports it and run.ts's
  existing warning says "models.<id> (supportsImages) ... is ignored with the <provider> provider".
- `/model`: `describeEntry` adds "text only" for `supportsImages: false`.
- No core change: the core already reads `supportsImages` everywhere it matters (see above).

## Before / after

| Setup                                               | Before                            | After                                                                             |
| --------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| GLM (`supportsImages: false`) reads `shot.png`      | image bytes sent to GLM           | note: "Delegate it with the new_task tool to mode `vision` (runs on Qwen3.8-27B)" |
| Same, no mode bound to an image model               | image bytes sent to GLM           | note: no mode can see images, continue without it                                 |
| `findImageCapableModes`, base GLM, `vision` on Qwen | every mode (all on sane defaults) | `vision` only                                                                     |
| `findImageCapableModes`, base Qwen, `code` on GLM   | every mode                        | every mode except `code`                                                          |
| Entry with only `supportsImages: false`             | ignored, info `null`              | `openAiCustomModelInfo = { ...saneDefaults, supportsImages: false }`              |
| `supportsImages: "no"`                              | ignored                           | startup error naming the model                                                    |
| `supportsImages` on an anthropic model              | silently ignored                  | startup warning, ignored                                                          |
| `/model` row of GLM                                 | `GLM-5.3-NVFP4 (262,144 tokens)`  | `GLM-5.3-NVFP4 (262,144 tokens, text only)`                                       |

## Tests

- `provider-config.test.ts`: an entry with only `supportsImages: false` gives the sane defaults with
  `supportsImages: false`; unset or `true` keeps `true`; anthropic gets no `openAiCustomModelInfo`; `withModel` brings
  the new model's image support and clears the previous model's text-only info when the new model has no entry.
- `model-settings.test.ts`: `supportsImages` accepted as true/false, `"true"` rejected; `listSetModelSettings` names
  it.
- `model-command.test.ts`: "text only" in the `/model` list, nothing for `true`.
- `src/core/webview/__tests__/ModeProfileBinding.findImageCapableModes.spec.ts`: settings shaped exactly as the CLI
  writes them (sane defaults spread plus the entry's keys): text-only base lists only the mode bound to the image
  model; image base lists every mode but the text-only one; `openAiCustomModelInfo: null` counts as seeing images.
  The core cannot import the CLI (dependency direction), so the shape is rebuilt in the spec from
  `openAiModelInfoSaneDefaults`.
- Existing coverage relied on: `readFileTool.spec.ts` (notice for `supportsImages: false`, modes named, own mode
  excluded), `image-cleaning.spec.ts`.

## Notes

- Default stays `true` (the sane default), so nothing changes for a config that does not set the key.
- A mode without its own model runs the top-level model, so with an image-capable top level every such mode is named
  in the notice. That is correct but long; binding the vision mode and leaving the top level text-only gives the short
  notice.
- Not changed: `resolveIncomingImages` still attaches an `@/image.png` mention as an image for a text-only model
  (it does not pass `supportsImages`); the image is stripped before sending, and the model only sees the path, without
  the "delegate to vision" notice until it calls `read_file` itself. A core fix (pass the model's `supportsImages` and
  add the notice to the mention) would cover VS Code too and belongs on its own branch.
- `formatModelSwitched`'s "no entry" sentence (128,000-token window, no prices, no effort) does not mention that such a
  model counts as seeing images; left as is to keep the line short.
