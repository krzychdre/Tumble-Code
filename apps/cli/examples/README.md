# Example CLI settings

[`cli-settings.example.json`](cli-settings.example.json) sets every option the
CLI reads from `~/.roo/cli-settings.json`. The file is plain JSON (no
comments), so the explanations are here. Copy it, keep what you need and
change the values:

```sh
cp apps/cli/examples/cli-settings.example.json ~/.roo/cli-settings.json
chmod 600 ~/.roo/cli-settings.json
```

The example describes an OpenAI-compatible server on the local network with
three models of different sizes, plus Anthropic for the `ask` mode. The
[Settings File](../README.md#settings-file) section of the CLI README has the
full rules; every key below links to them.

## Top level

| Key                       | In the example                     | What it does                                                                                                                                          |
| ------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`                | `"openai"`                         | Provider id, as for `--provider` (`openai` is any OpenAI-compatible server).                                                                          |
| `baseUrl`                 | `"http://192.168.50.194:11111/v1"` | The server's base URL, for providers that have one.                                                                                                   |
| `model`                   | `"GLM-5.3-Flash-NVFP4"`            | Model id exactly as the provider names it.                                                                                                            |
| `apiKey`                  | `"1111"`                           | The key. Keep the file readable only by you, or use `apiKeyEnv` instead.                                                                              |
| `apiKeyEnv`               | (used in `models`)                 | Name of an environment variable holding the key; the run stops naming it when it is unset. `apiKey` wins when both are set.                           |
| `mode`                    | `"code"`                           | Mode a new session starts in (`tumble list modes`).                                                                                                   |
| `requireApproval`         | `false`                            | `true` asks before every action, as `--require-approval`.                                                                                             |
| `consecutiveMistakeLimit` | `10`                               | Mistakes in a row before the CLI asks for guidance.                                                                                                   |
| `commandExecutionTimeout` | `300`                              | Seconds a shell command may run; `0` means no limit, at most 2147483.                                                                                 |
| `maxParallelSubagents`    | `6`                                | Subagents running at once in the whole run (default 3, at most 8; `0` or `1` turns them off). Each model's `maxConcurrentRequests` caps them further. |
| `oneshot`                 | `false`                            | `true` exits when the task completes, as `--oneshot`.                                                                                                 |
| `mcpSettingsPath`         | `"~/.roo/mcp.json"`                | File with the global MCP servers (the default shown); `~` is the home directory.                                                                      |
| `cloudApiUrl`             | `"https://cloud.example.com"`      | Tumble Code Cloud API for `tumble auth cloud login` and telemetry; leave it out without a cloud.                                                      |
| `timeZone`                | `"Europe/Warsaw"`                  | IANA zone for the times shown and told to the model; only needed where the system zone is missing.                                                    |
| `modes`                   | two entries                        | Provider settings per mode, see below.                                                                                                                |
| `models`                  | four entries                       | Facts per model, see below.                                                                                                                           |

Not in the example on purpose: a top-level or per-mode `reasoningEffort` is
ignored with a warning (the level is set per model, in `models`), and
`dangerouslySkipPermissions` is a legacy inverse of `requireApproval`.

## `modes`

An entry may set `provider`, `model`, `baseUrl`, `apiKey` and `apiKeyEnv`, and
inherits the rest from the top level ([Settings per mode](../README.md#settings-per-mode)).

- Each entry here changes only the model. Where that model runs comes from its
  `models` entry: `architect` stays on the top-level server and `ask` moves to
  Anthropic with `claude-sonnet-5-5`. `debug` gets its model the other way
  round, from the `modes` list of `Qwen3.8-4B`, and moves to that model's
  server.
- Every entry is checked at startup. The Anthropic model needs
  `ANTHROPIC_API_KEY`; without it, remove `ask` and the `claude-sonnet-5-5`
  entry, or the run stops at startup.

## `models`

Keyed by model id. An entry applies wherever the model runs: the top level, a
mode entry, `--model` or `/model`. Its connection keys override the top level
and the mode entry; only the flags override them.

| Key                     | Providers | What it does                                                                                                                                                   |
| ----------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`              | all       | The model's own provider; it then inherits no base URL or key from the top level or the mode ([Connection per model](../README.md#connection-per-model)).      |
| `baseUrl`               | all       | The model's own server; without `provider` it keeps the provider of where it runs.                                                                             |
| `apiKey`                | all       | The model's own key.                                                                                                                                           |
| `apiKeyEnv`             | all       | Environment variable holding the model's own key.                                                                                                              |
| `reasoningEffort`       | all       | Thinking level: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `unspecified` (model default) or `disabled`; the model must accept it.             |
| `modelSize`             | all       | `standard`, `slim` or `compact`: how much system prompt and how many tools the model gets ([Model size](../README.md#model-size)).                             |
| `hideMcp`               | all       | With `slim`, `false` keeps the MCP tools (default `true`).                                                                                                     |
| `maxConcurrentRequests` | all       | Requests the server takes for this model at once; caps the subagents on it ([Concurrent requests per model](../README.md#concurrent-requests-per-model)).      |
| `contextWindow`         | `openai`  | Context window in tokens; without it 128,000 is assumed.                                                                                                       |
| `inputPrice`            | `openai`  | USD per million input tokens not read from the prompt cache.                                                                                                   |
| `outputPrice`           | `openai`  | USD per million output tokens, reasoning included.                                                                                                             |
| `cacheReadsPrice`       | `openai`  | USD per million input tokens read from the prompt cache.                                                                                                       |
| `cacheWritesPrice`      | `openai`  | USD per million input tokens written to the prompt cache (defaults to `inputPrice`).                                                                           |
| `preserveReasoning`     | `openai`  | Send the model's earlier reasoning back with every request.                                                                                                    |
| `trimOldReasoning`      | `openai`  | With `preserveReasoning`, shorten old reasoning once the context fills up.                                                                                     |
| `supportsImages`        | `openai`  | `false` for a text-only model: it hands images to a mode whose model sees them instead of receiving them ([Text-only models](../README.md#text-only-models)).  |
| `modes`                 | all       | The modes that run this model, e.g. `["debug"]`; the same as `"model"` in each of their `modes` entries ([Settings per mode](../README.md#settings-per-mode)). |

The example gives each size one model: `GLM-5.3-Flash-NVFP4` is a large model
with the full prompt, prices and returned reasoning; `GLM-5.3-NVFP4` uses the
slim toolset and keeps MCP; both GLM models are text-only and say so with
`supportsImages: false`, since every `openai` model is otherwise taken to see
images; `Qwen3.8-4B` is a small 32k model in compact mode
without reasoning, served by a second server with its own key (still the
`openai` provider) and run by the `debug` mode; `claude-sonnet-5-5` runs on Anthropic with the key from
`ANTHROPIC_API_KEY` and sets only keys every provider takes, since Anthropic
sizes and prices its models itself and the `openai`-only keys would be ignored
with a warning.

`maxConcurrentRequests` gives each model what its server takes at once: the
Flash server serves 4 requests in parallel, the larger GLM server 2, the small
Qwen server 1 and the Anthropic plan 8, so a fan-out of subagents never sends a
server more requests than it serves.
