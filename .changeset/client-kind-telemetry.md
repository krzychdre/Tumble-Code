---
---

Everything sent to the cloud now says which client produced it: telemetry events, error reports and LLM exchanges carry `clientKind` ("vscode" or "cli") and, from the CLI, `clientVersion` (the CLI package version, published to the extension as the new `ROO_CLI_VERSION` runtime variable). The cloud can then tell VS Code and CLI usage apart.
