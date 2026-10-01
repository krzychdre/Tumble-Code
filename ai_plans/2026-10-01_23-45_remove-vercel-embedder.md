# Remove the Vercel AI Gateway code index embedder

Status: done (branch `chore/remove-vercel-embedder`), simplification round 2 item B12 (owner decision).

## Touched files

- Deleted: `src/services/code-index/embedders/vercel-ai-gateway.ts` and its spec.
- `src/services/code-index/`: `config-manager.ts`, `service-factory.ts`, `interfaces/{config,embedder,manager}.ts`,
  `embedders/__tests__/embedder-contract.spec.ts`, `__tests__/config-manager.spec.ts`.
- `src/shared/embeddingModels.ts` (model profiles and default model).
- `src/core/webview/messageHandlers/codeIndex.ts` (secret store and `hasVercelAiGatewayApiKey` status flag), its
  spec and the routing snapshot.
- `packages/types/src/`: `codebase-index.ts`, `embedding.ts`, `global-settings.ts` (secret key list),
  `vscode-extension-host.ts`, two schema snapshots, new `__tests__/codebase-index-config.spec.ts`.
- `webview-ui/src/components/code-index/`: `embedderForms.tsx`, `codeIndexSettings.ts`, `useCodeIndexSettings.ts`,
  per-provider spec.
- i18n: `vercelAiGatewayProvider`, `vercelAiGatewayApiKeyLabel`, `vercelAiGatewayApiKeyPlaceholder`,
  `validation.vercelAiGatewayApiKeyRequired` (18 webview `settings.json`), `serviceFactory.vercelAiGatewayConfigMissing`
  (18 `src` `embeddings.json`).
- `.changeset/remove-vercel-embedder.md`

Not touched: the retired chat provider entry `{ id: "vercel-ai-gateway", lifecycle: "retired" }` in
`packages/types/src/provider-registry.ts` (chat provider, and the file is in pending PR #680) and its
`provider-registry.spec.ts` row; the `apiProvider` enum lines in the snapshots come from that registry.

## Problem

The chat provider Vercel AI Gateway is retired, but the code index still offered it as an embedder, with its own
secret (`codebaseIndexVercelAiGatewayApiKey`), form, model table and translations. The owner decided to remove it.

## What happens to users who had it selected

The stored `codebaseIndexConfig.codebaseIndexEmbedderProvider` stays `"vercel-ai-gateway"` in global state.

- Code index runtime (`CodeIndexConfigManager`): it reads the raw stored value. Before, an unknown value fell back
  to OpenAI (the `else` branch), which with a stored `codeIndexOpenAiKey` would have started indexing with OpenAI,
  a provider the user did not choose. Now OpenAI is the default only when no provider is saved; a saved unknown
  provider sets `unknownEmbedderProvider`, `isConfigured()` returns false, and a warning is logged. The index sits
  in the normal not-configured state; picking another embedder and saving goes through the existing
  "unconfigured to configured" restart rule.
- Settings schema: `codebaseIndexEmbedderProvider` gets `.catch(undefined)`, so `globalSettingsSchema.parse`
  (settings export, import, `getGlobalSettings`) does not fail on the stale value; only that field reads as unset.
- Webview: the state carries the raw value; `getEmbedderForm` already returns `undefined` for an unknown provider,
  so the popover opens with the Qdrant fields and no provider fields, and the user picks an embedder.
- Stored secret: `codebaseIndexVercelAiGatewayApiKey` is no longer in `SECRET_STATE_KEYS`, so it is never loaded or
  sent anywhere; it stays in VS Code's secret storage, unused (also not deleted by "reset all state").

## Tests

- `config-manager.spec.ts`: a saved config with `vercel-ai-gateway`, a leftover Vercel secret and a stored OpenAI
  key is not configured and does not throw (fails without the guard: it fell back to OpenAI and reported
  configured); switching to OpenAI afterwards reports configured and requires a restart.
- `codebase-index-config.spec.ts` (types): the global settings schema parses such a config with the provider unset.
- Webview per-provider spec: the Vercel row is gone (7 providers); new case opens the popover with the removed
  provider saved and shows no provider fields.
- Snapshots updated deliberately: only `codebaseIndexVercelAiGatewayApiKey` lines (flat schema keys, flat schema,
  secret keys, arms) and the routing snapshot's secret read and status flag disappear.
- Green: all `src/services/code-index`, `src/shared/__tests__`, `ContextProxy`, code index message handler and
  routing specs; webview `components/code-index`; whole `packages/types` suite. `tsc --noEmit` in types, src,
  webview-ui.

## Notes

- `vscode-extension-host.ts` (WebviewMessage `codeIndexSettings` payload) loses the `"vercel-ai-gateway"` union
  member and the optional `codebaseIndexVercelAiGatewayApiKey` field: not additive, but webview and extension ship
  together and the owner asked for removal everywhere.
- `webview-ui/src/i18n/__tests__/pluralForms.spec.ts` has 5 failures on origin/main (`webSearch.queryCount` in
  ca/es/fr/it/pt-BR `chat.json`, from #663); unrelated, not touched here.
- Schema snapshot files are also changed by PR #680; a merge conflict there is resolved by re-running the two
  snapshot specs with `-u`.
