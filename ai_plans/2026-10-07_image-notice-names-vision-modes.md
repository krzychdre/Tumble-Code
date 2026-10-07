# The unsupported-image notice names the modes that can see images

**Status:** done on branch `fix/image-notice-names-vision-modes`.
**Related plans:** `archive/2026-08/2026-08-13_vision-mode-image-analysis.md` (added the delegation hint; its
follow-up "make the hint conditional on a vision-capable mode actually existing" is what this change does).
**Sibling branches (not touched here):** (a) a `new_task` delegation depth limit and same-mode guard, (b) the wrong
`rootTaskId` lineage of nested subtasks. This branch changes neither `NewTaskTool` nor `ClineProvider.createTask`.

## Symptom

A task on GLM-5.3 (text-only, profile `supportsImages=false`) in Code mode delegated "look at this screenshot" to Ask
mode with `new_task` (root task `01a11598-6328-743d-87f3-24f02ad97650`, first Ask child
`01a1159a-bc02-7131-8ad8-cea7e6ad4321`). In Ask, `read_file` on the PNG returned:

> Image file detected but current model does not support images. Skipping image processing. If a vision-capable
> mode is available (see MODES), delegate this image to it with the new_task tool - include the image path and your
> question - and continue using the textual description it returns.

No vision-capable mode existed: the user's custom `vision` mode was missing and no mode had a vision-capable API
profile pinned through `modeApiConfigs`. The model reasoned: "I can't know which mode is vision capable; likely code
or ask... delegating to ask mode might hit the same limitation. But the instruction says to try." It called
`new_task(mode "ask", "...you have vision capabilities...")`, and every child did the same: about 90 nested
subtasks, all Ask or Code on the same GLM profile, each rewriting "you have vision".

## What was happening

- `src/core/tools/helpers/imageHelpers.ts:108` (before the fix) returned one fixed sentence for every setup. It told
  the model to delegate "if a vision-capable mode is available (see MODES)", but the MODES section of the system
  prompt lists mode names and descriptions only, never the model a mode runs on. A model cannot tell from it which
  mode can see images, so a weak model guesses, and its guess is another text-only mode.
- The child gets the same notice and the same instruction, so the guess repeats at every level. Nothing in the
  notice ever said "stop".
- The information needed to answer the question exists at runtime: `ModeProfileBinding.resolve`
  (`src/core/webview/ModeProfileBinding.ts`) knows which profile a mode runs on (CLI per-mode settings, the workspace
  lock, or the profile pinned in `modeApiConfigs`), and `resolveProviderModel` (`src/api/index.ts`, the single model
  resolver shared by the request and the settings) gives that profile's `ModelInfo.supportsImages`.

## Failure surface before/after

| Setup                                                 | Before                                                    | After                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| No mode pinned to an image-capable profile (incident) | "delegate if a vision-capable mode is available" -> guess | "No other mode ... can see images. Do NOT delegate ... tell the user"            |
| `vision` mode pinned to an image-capable profile      | same conditional sentence; model must guess the slug      | "Delegate it with the new_task tool to mode `vision` (runs on qwen3.6-35b)"      |
| Several image-capable modes                           | same conditional sentence                                 | "to one of these modes: `vision` (runs on ...), `designer` (runs on ...)"        |
| Pin left in `modeApiConfigs` for a deleted mode       | same conditional sentence                                 | the deleted mode is not listed (only existing modes are checked)                 |
| Workspace locks one API profile across modes          | same conditional sentence                                 | none listed: every mode runs on the current text-only profile                    |
| CLI with per-mode settings in `cli-settings.json`     | same conditional sentence                                 | modes whose CLI settings resolve to an image-capable model are listed            |
| Profile store unreadable, provider unknown, any error | same conditional sentence                                 | that mode is skipped; a total failure counts as "none", which forbids delegation |

## Fix

- `ModeProfileBinding.findImageCapableModes()` walks every existing mode (`getAllModes` over built-in and custom
  modes), resolves its own provider settings with the existing `resolve(mode)` (CLI entry, or the `usable` pinned
  profile read with `getProfile`, no activation), and keeps the modes whose `resolveProviderModel(settings).info`
  has `supportsImages`. A mode without its own settings runs on the current profile, which is text-only whenever the
  notice is shown, so it never qualifies. Every per-mode error is swallowed (the mode is skipped).
  `ClineProvider.findImageCapableModes()` delegates to it.
- `getApiConfigurationForMode` was not reused because it calls `activateProfile`, which writes
  `currentApiConfigName` into the profile store: a read on every image would have had a side effect.
- `ReadFileTool.findOtherImageCapableModes(task)` asks the provider only when the model does not support images,
  drops the task's own mode, and returns `[]` on any failure.
- `validateImageForProcessing` takes the list as an optional sixth argument (default `[]`) and builds the notice
  with `buildUnsupportedImageNotice`:
    - one or more modes: "Image file detected but the current model does not support images, so the image was not
      loaded. Delegate it with the new_task tool to mode `vision` (runs on qwen3.6-35b). Include the image path and
      your question, then continue with the textual description it returns. Do not delegate the image to any other
      mode: those cannot see images either."
    - none: "Image file detected but the current model does not support images, so the image was not loaded. No
      other mode in this setup runs on a model that can see images. Do NOT delegate this image with the new_task
      tool: any other mode would hit the same limit. Do not claim vision capabilities and do not ask anyone to "use
      vision capabilities". Continue without the image and tell the user that the image could not be viewed. The
      user can enable this by pinning a vision-capable API profile to a mode (for example a Vision mode)."
- The notice is model-facing English, not an i18n string; `grep "vision-capable"` finds no other copy
  (`resolveImageMentions` returns early for text-only models and never shows the notice).

## Tests

- `src/core/tools/helpers/__tests__/imageHelpers.spec.ts`: the named branch (one mode with its model, several
  modes, a mode without a model id) and the none branch (no list, empty list) with every load-bearing sentence.
- `src/core/tools/__tests__/readFileTool.spec.ts`: the tool passes the provider's modes minus the task's own mode,
  passes `[]` when the lookup throws, and does not look modes up when the model supports images.
- `src/core/webview/__tests__/ModeProfileBinding.findImageCapableModes.spec.ts` (new, plain host object, real
  `resolveProviderModel`): only a mode pinned to an image-capable profile is listed; the incident setup lists none;
  a pin of a deleted mode, the workspace lock, an unreadable profile and an unknown provider are skipped; CLI
  per-mode settings win over the store.
- Mutation check: with the old notice, the old `ReadFileTool` wiring and a `findImageCapableModes` that ignores the
  modes, 9 of the new tests fail; with the fix all pass.

## Notes

- Cost: the lookup runs only on the text-only image path, once per image, and reads the profile store a few times
  per mode. No network calls; `resolveProviderModel` reads model caches only.
- The current task's own mode is excluded even if its pinned profile could see images (the task may run on a sticky
  text-only profile). Switching profiles inside the same mode is out of scope.
- This change does not stop a model that ignores the notice. The sibling branch with the delegation depth and
  same-mode guard is the hard stop; this branch removes the instruction that caused the loop.
