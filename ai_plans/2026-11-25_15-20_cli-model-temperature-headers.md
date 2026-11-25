# Temperature and HTTP headers per model in the CLI

Status: done, merged as #1371.

## Problem

After #1368 the CLI takes a VS Code profile's model facts, but not its temperature (`modelTemperature`) or its custom
HTTP headers (`openAiHeaders`), and a `models` entry of cli-settings.json could not set them either. The owner needs
both (headers for the gateways in front of the model servers); the other gaps from #1368 can wait.

## Fix

- `CliModelSettings.temperature` (every provider, 0 to 2 like the VS Code slider) and `headers` (openai provider,
  string values); `findModelSettingsProblems` rejects other values; `temperature` counts as a key every provider
  takes, `headers` is reported as ignored with another provider.
- `toProviderSettings` writes `modelTemperature` (null clears an earlier run's value) and, for openai,
  `openAiHeaders` (`{}` clears).
- `readVscodeProfiles` maps a profile's `modelTemperature` and openai `openAiHeaders`, so they come from VS Code
  under the `models` entry field by field.
- README (Temperature and headers per model, the `vscode` paragraph), examples JSON and README.

## Tests

`model-settings.test.ts`, `provider-config.test.ts`, `vscode-profiles.test.ts`, `run.test.ts` (headers and
temperature reach the host from the VS Code profile); mutation-checked.
