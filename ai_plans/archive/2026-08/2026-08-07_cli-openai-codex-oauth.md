# CLI OpenAI Codex OAuth

## Goal

Allow the Tumble CLI to use the extension's `openai-codex` provider with a ChatGPT Plus/Pro subscription, without requiring an OpenAI API key.

## Design

1. Reuse the existing extension OAuth implementation and token lifecycle. The CLI already activates the extension with a persistent `ExtensionContext` shim, so the same manager can read and refresh credentials from the shim's secret storage at runtime.
2. Add `tumble auth codex login|logout|status` commands. The commands create only the minimal shim context needed by the OAuth manager, use the existing localhost callback flow, and persist credentials in the same CLI shim storage used when the extension runs.
3. Make the shim's `env.openExternal` open the system browser in CLI mode, with safe argument-based spawning instead of shell interpolation. Login always prints the URL as a manual fallback.
4. Treat `openai-codex` as a supported keyless CLI provider and persist it like all other providers.
5. Reject `--ephemeral` with `openai-codex`: ephemeral storage cannot contain the durable login and would otherwise fail later with an opaque provider error.

## Security

- Keep PKCE and OAuth state validation from the existing implementation.
- Never print access or refresh tokens.
- Keep credentials in the shim secret store with owner-only file permissions.
- Do not accept subscription tokens through flags or environment variables.

## Tests

- Provider registry/settings tests prove `openai-codex` is supported and keyless.
- Codex auth command tests cover login success/failure, status, logout, cleanup, and browser fallback without network access.
- Shim tests cover external URL opener delegation.
- CLI run tests cover the ephemeral-mode guard.

## Documentation

Document the new auth commands and the exact login/run workflow, while distinguishing ChatGPT subscription OAuth from OpenAI API-key billing.
