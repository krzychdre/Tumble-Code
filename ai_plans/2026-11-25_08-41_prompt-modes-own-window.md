# MODES list from the window's own custom modes

Status: in progress. Overview: `2026-11-25_08-20_prompt-cache-overview.md`.

## Problem

`getModesSection` and `getCompactModesSection` built the modes list through `getAllModesWithPrompts(context)`, which
read `context.globalState.get("customModes")` (`src/core/prompts/modeDetails.ts`). Every other part of the prompt
gets the custom modes from `SystemPromptOptions.customModes`, which `ProviderStateBuilder` fills from this window's
`CustomModesManager.getCustomModes()`.

`globalState` is stored by the VS Code client and shared between its windows, a Remote-SSH window included.
`CustomModesManager.getCustomModes()` writes its merged list there on every refresh (10 s cache). The Remote-SSH
window on 192.168.50.194 has `custom_modes.yaml` with `customModes: []`, so it kept writing `[]`; the local window's
next prompt listed only built-in modes, and its own refresh wrote the full list back. In the esp32-modulator session
the system prompt flipped 26 times, each flip invalidating the cached conversation: 1.13M uncached tokens, 29% of the
session's total.

## Fix

`getAllModesWithPrompts(customModes, customModePrompts)` is a pure function of the prompt options; both modes sections
take the same two values `SYSTEM_PROMPT` already receives. The prompt no longer reads `globalState` at all. The
directory side effect (`ensureSettingsDirectoryExists`) leaves the prompt; `CustomModesManager` and `McpHub` create
the directory themselves.

`SystemPromptOptions.context` is now unused by the prompt builder; removing it touches about thirty callers and is
left as a separate cleanup.

## Tests

- `compact-profile-prompt.spec.ts`: both the long and the compact prompt list a custom mode passed in the options
  while the mocked `globalState` is empty (fails on the old code, which listed built-ins only).
- `modeDetails.spec.ts`: the helper with the new signature.

KV-cache: prefix-stable for a window whose shared state agreed with its own modes; the flips stop.
