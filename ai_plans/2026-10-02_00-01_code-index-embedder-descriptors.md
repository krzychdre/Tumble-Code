# Code-index embedder descriptors (one table per embedder)

Status: done on `refactor/code-index-embedder-descriptors`, PR open, not merged.

## Touched files

- `src/services/code-index/embedders/descriptors.ts` (new): `EMBEDDER_DESCRIPTORS`, `findEmbedderDescriptor`,
  `readEmbedderOptions`, `snapshotEmbedderOptions`
- `src/services/code-index/config-manager.ts`
- `src/services/code-index/service-factory.ts`
- `src/services/code-index/__tests__/embedder-config.characterization.spec.ts` (new) and its snapshot file

## Problem

Every embedder was spelled out once per concern. In `config-manager.ts` Mistral alone appeared in the private field,
the secret read, the provider if-chain, the options assignment, the `loadConfiguration` return type, the previous
snapshot, the `currentConfig`, `isConfigured`, the previous and current restart variables, the restart comparison and
`getConfig` (about 13 places). `service-factory.ts` `createEmbedder` repeated the same knowledge as an if-chain of seven
branches, each with its own completeness check, error key and constructor call. Adding or removing an embedder (the
Vercel removal in #689) meant touching all of these places in two files.

## Fix

One descriptor per embedder in `embedders/descriptors.ts`: id, the option group key in `CodeIndexConfig`, the i18n key
of the "config missing" error, `read` (saved config and secrets to the option group), `isConfigured`, `snapshot`
(the restart-relevant fields of `PreviousConfigSnapshot`) and `create` (the embedder class and its arguments).

- `CodeIndexConfigManager` keeps one `embedderOptions` object instead of seven fields; loading, the previous snapshot,
  `isConfigured`, restart detection and `getConfig` iterate the table. The public shapes (`CodeIndexConfig`,
  `PreviousConfigSnapshot`, `loadConfiguration`'s result) are unchanged, including keys that are present with an
  `undefined` value.
- `CodeIndexServiceFactory.createEmbedder` looks up the descriptor, checks `isConfigured` and calls `create`.

## Tests

The characterization spec was committed first, against the old code, and passes unchanged after the refactor:

- `getConfig()` for a config with every setting saved, and for an empty one (inline snapshots, `undefined` keys
  included);
- per provider: configured or not, the embedder class the factory builds and its exact constructor arguments;
- per provider without credentials: unconfigured, and the exact error the factory throws;
- per provider: which of 12 settings changes restart indexing.

Existing specs still green: all of `src/services/code-index/__tests__`, `embedders/__tests__`,
`core/webview/__tests__/webviewMessageHandler.codeIndexSettings.spec.ts`.

## Notes and caveats

- The embedder classes stay as they are (`GeminiEmbedder`, `MistralEmbedder` with their own base URL, default model and
  item-token limit): the factory must keep building the same classes, and their `embedderInfo.name` and telemetry
  names differ. Folding them into the OpenAI-compatible class with a descriptor-held base URL would change those
  names, so it is left out.
- The webview save handler (`messageHandlers/codeIndex.ts`) and the secret status message still list the secret keys
  explicitly: their order and flag names are pinned by a spec and by the `ExtensionMessage` shape. The webview form
  already has its own per-embedder table (`webview-ui/src/components/code-index/embedderForms.tsx`); it was not tied
  to this host-side table because the webview cannot import host modules.
- Restart detection still compares the fields of every embedder, not only the selected one (pinned by the
  characterization spec).
