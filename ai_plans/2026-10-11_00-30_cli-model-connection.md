# CLI: provider and endpoint per model

Status: done on `feat/cli-model-connection` (local only, stacked on `feat/cli-settings-example` <- `feat/cli-model-size`
<- `feat/compact-small-model-profile`, not merged).

## Goal

The owner wants a model in `cli-settings.json` to carry its own provider and endpoint, so e.g. a small model on a
second llama.cpp server or a Claude model on Anthropic can be named in `modes` or `/model` without repeating the
connection everywhere.

## Shape

`models.<id>` takes `provider`, `baseUrl`, `apiKey`, `apiKeyEnv` (the keys of the top level and of `modes`).

- `modelConnectionLayer(model, entry)` turns them into a provider-config layer that names the model, undefined when
  none is set.
- `resolveProviderConfigWithModel({ fallback, layers, top, models, model? })` resolves as before, then, when the
  resolved model has a connection layer, resolves again with it between `layers` (top level, mode entry) and `top`
  (the flags). The existing scoping rule of `resolveProviderConfig` does the rest: an entry naming another provider
  inherits no base URL or key; one naming only `baseUrl` or a key keeps the provider below it. `model` forces the
  model id (for /model).
- `run.ts`: the base and every mode resolve through it. `resolveForModel(mode, model)` (mode layers unless provider
  flags are given, flags on top without their model) backs the new `ExtensionHostOptions.resolveModelProviderSettings`,
  which `ExtensionHost.switchModel` prefers over `withModel`. That makes /model recompute the whole connection, so a
  model without its own connection returns to the mode's after one that had one (withModel kept the current
  connection, which would have left it on the previous model's server). A missing key throws; the TUI shows the
  message as "Could not switch the model: ...".
- Startup: every entry with a connection is resolved against the top level and checked with
  `findProviderConfigProblem` (label `models.<id> in <path>`), like a mode entry. A model entry's `apiKey` counts for
  the chmod 600 warning. `findModelSettingsProblems` requires the four keys to be non-empty strings;
  `listSetModelSettings` skips them (every provider takes them).
- No core change: the CLI already sends whole ProviderSettings per mode (`cliModeProviderSettings`), and
  `ModeProfileBinding.applyCliProviderSettingsToCurrentMode` rebuilds the task's handler, provider change included.

## Tests

- `provider-config.test.ts`: no-entry identity, base URL keeps provider and key, another provider inherits nothing,
  flags above the entry, forced model.
- `run.test.ts` ("a model on its own connection"): startup on the model's server, a mode's model on another provider,
  /model there and back, missing key message, flags override, startup failure naming the model.
- `extension-host.test.ts`: switchModel takes the resolver's settings.
- `model-settings.test.ts`: string checks, no ignored-key warning.
- Docs: README "Connection per model"; the example settings file and its explanations use it (`Qwen3.8-4B` on a
  second server, `claude-sonnet-5-5` on Anthropic).
