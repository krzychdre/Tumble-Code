# Vision becomes a built-in mode

Status: done on `feat/vision-builtin-mode` (cut from origin/main 697b16768), not pushed.

Related plans: `archive/2026-08/2026-08-13_vision-mode-image-analysis.md` (the mode as a user custom mode),
`2026-10-07_image-notice-names-vision-modes.md` (#808, the read_file notice names image-capable modes),
`2026-10-07_new-task-delegation-guard.md` (#807, the same-mode `new_task` guard).

Touched:

- `packages/types/src/mode.ts`
- `packages/types/src/__tests__/vision-builtin-mode.spec.ts` (new)
- `src/core/webview/ModeProfileQueries.ts`
- `src/core/webview/__tests__/ModeProfileQueries.spec.ts`
- `src/core/webview/__tests__/ModeProfileBinding.findImageCapableModes.spec.ts`
- `src/core/prompts/__tests__/__snapshots__/compact-off-golden/system-prompt.{default,slim}.{architect,code,ask,debug,orchestrator}.snap`
- `src/core/prompts/__tests__/__snapshots__/compact-profile/system-prompt.{architect,code,ask,debug,orchestrator}.snap`
- `src/core/prompts/__tests__/__snapshots__/compact-tools/sizes.json.snap`
- new snapshots for the vision mode: `compact-off-golden/{system-prompt,native-tools}.{default,slim}.vision*`,
  `compact-profile/system-prompt.vision.snap`, `compact-tools/{native,openai}-tools.vision.json.snap`
- `ai_plans/assets/vision-mode.yaml` (deleted), `ai_plans/README.md`
- `README.md`, `apps/cli/README.md`
- `.changeset/vision-builtin-mode.md`

## Need

Owner decision 2026-10-13: the `vision` mode becomes a built-in mode next to architect, code, ask, debug and
orchestrator. As a user custom mode it lived in one settings file only: it was lost from the VS Code settings once,
and the CLI, which keeps its own extension storage, never had it. Without the mode, the read_file image notice has
nothing to offer a text-only model.

## What was happening

- Built-in modes are `DEFAULT_MODES` in `packages/types/src/mode.ts:203`; the vision mode existed only as the YAML
  `ai_plans/assets/vision-mode.yaml`, copied by hand into
  `~/.config/Code/User/globalStorage/qub-it.tumble-code/settings/custom_modes.yaml`.
- The CLI's extension host keeps its global storage in its own directory
  (`packages/vscode-shim/src/context/ExtensionContext.ts:82-86`), so the VS Code global custom modes never reach it.
- `ModeProfileBinding.findImageCapableModes()` (`src/core/webview/ModeProfileBinding.ts:470`) already walks
  `getAllModes(customModes)` (`src/shared/modes.ts:83`), built-ins included, and keeps a mode only when its own
  provider settings (pinned profile, or CLI `modes.<slug>` entry) resolve to a model with `supportsImages`. So a
  built-in vision mode is offered by the notice exactly when the user bound a vision-capable model to it.
- `ModeProfileQueries.getModes()` (`src/core/webview/ModeProfileQueries.ts:43`, the `requestModes` answer that feeds
  `tumble list modes`, the CLI mode picker and Shift+Tab) returned `[...DEFAULT_MODES, ...customModes]` without
  removing the built-ins a custom mode overrides. With a built-in `vision` and the owner's custom `vision`, the CLI
  would have listed vision twice. The new test in `ModeProfileQueries.spec.ts` failed on the old code with exactly
  that duplicate (`[{ name: "👁️ Vision" }, { name: "My Vision" }]`). The system prompt, the webview and
  findImageCapableModes all use `getAllModes`, which already replaces in place.

## Change

- `DEFAULT_MODES` gets a sixth entry, last, so the cycle order of the existing modes does not change:
  slug `vision`, name `👁️ Vision` (built-ins carry an emoji in the name and no icon field; the webview's line icon map
  in `webview-ui/src/components/chat/modeIcon.tsx` already had `vision: Eye`), groups `read` and `command`. The
  whenToUse, description and customInstructions are the YAML's, byte for byte (checked with a script parsing the
  YAML). The roleDefinition is the YAML's except the opener: "You are Tumble Code, ..." became "You are Tumble, ...",
  the identity every other built-in uses. Nothing in the texts called the mode "custom".
- `ModeProfileQueries.getModes()` puts a custom mode with a built-in slug in the built-in's place and lists the slug
  once, the same rule as `getAllModes`.
- `ai_plans/assets/vision-mode.yaml` is deleted, not reduced to a pointer: the built-in is the only source now, and a
  stale YAML invites copying it back into custom_modes.yaml. `ai_plans/README.md` says so. The archived 2026-08-13
  plan still names the file; it is history and stays as written.
- Docs: the root README mode lists and the CLI README ("Settings per mode": how to give `vision` a model with
  `modes.vision`).

## Before / after

| Situation                                                     | Before                                        | After                                                               |
| ------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| VS Code, fresh install                                        | no vision mode                                | Vision in the mode list (bound to the default profile on first run) |
| CLI                                                           | no vision mode (own storage, no custom modes) | `vision` in `tumble list modes`, the picker and Shift+Tab, last     |
| Vision bound to a vision-capable profile / CLI `modes.vision` | only with the custom mode present             | read_file notice offers `vision` (runs on <model>)                  |
| Vision bound to a text-only profile or not bound              | not offered                                   | not offered (unchanged rule)                                        |
| Custom `vision` in custom_modes.yaml plus the built-in        | n/a                                           | the custom one wins everywhere; listed once (getModes fixed)        |
| System prompt MODES section                                   | five modes                                    | six modes, vision last                                              |

## Tests

- `packages/types/src/__tests__/vision-builtin-mode.spec.ts`: the built-in exists with groups `["read", "command"]`,
  comes last after the five older slugs, passes `modeConfigSchema`, has role, use case and instructions, and does not
  call itself a custom mode.
- `ModeProfileBinding.findImageCapableModes.spec.ts`: the fixture no longer adds a custom vision mode (the built-in
  is there). New cases: built-in vision offered when its pinned profile supports images; not offered when the pinned
  profile is text-only; not offered when nothing is pinned to it; a custom `vision` overriding the built-in is listed
  once; an image-capable custom mode is listed after the built-in vision. The "pin left behind by a deleted mode" case
  now uses a deleted custom `designer`, since `vision` can no longer disappear.
- `ModeProfileQueries.spec.ts`: a custom `vision` replaces the built-in in place and the slug is listed once.
- Prompt snapshots regenerated with `-u`. In each of the 15 changed `system-prompt.*.snap` files the diff is exactly
  one added line in the modes list (`* "👁️ Vision" mode (vision) - ...` in the full prompt, `- vision: 👁️ Vision` in
  the compact prompt); nothing else moved. `compact-tools/sizes.json.snap` gains a `vision` entry only. The native
  tool snapshots of the existing modes did not change. Seven new vision snapshot files were written.
- Runs: types suite (47 files), full src suite (only the dist-dependent tree-sitter / dist_assets specs fail, `src/dist`
  is absent in this worktree), webview modes/chat/hooks/context/utils/settings, full CLI suite; tsc for types and
  src; eslint on the changed .ts files.

## Notes

- What the owner should do once the new build is installed: delete the `vision` entry from the global
  `custom_modes.yaml` (VS Code: Modes view, Vision, delete; or remove it from the file). Until then the custom entry
  overrides the built-in, which is harmless (same texts except the "Tumble Code" opener) but keeps the old copy
  authoritative. The API profile binding survives the switch: `modeApiConfigs` is keyed by slug, so `vision` keeps
  its pinned profile.
- The binding stays the user's job. On a fresh VS Code install the profile manager seeds every built-in, vision
  included, with the default profile (`src/core/config/ProviderSettingsManager.ts:56`); the notice offers vision only
  once that profile, or another one pinned to it, has a model with `supportsImages`.
- CLI with the `openai` provider: every model gets `openAiModelInfoSaneDefaults` (`supportsImages: true`) unless
  overridden, and `cli-settings.json` has no key to say a model cannot see images
  (`apps/cli/src/lib/utils/provider-config.ts:293-327`). So under that provider read_file sends images straight to
  the model and the notice never appears; vision is then reached only when someone delegates to it on purpose. This
  branch does not change that.
- `prefix-stability.spec.ts` keeps its fixed list of five modes: it measures the prompt head shared by mode switches,
  and orchestrator already covers the worst case (no `mcp` group). Vision lacks `mcp` too and adds nothing there.
- No i18n keys: built-in mode names and descriptions are not localized (they live in English in `DEFAULT_MODES`).
- The marketplace (`marketplace/modes/`) has no vision entry, so nothing offers a duplicate there.
