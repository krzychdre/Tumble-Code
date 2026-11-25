# The CLI runs the code index with the editor's settings or its own

Status: in progress.

## Problem

Second part of "code indexing in the CLI as in VS Code" (first part: #1375, the shim's file watcher). The CLI never
had code index settings: `codebaseIndexConfig` was left out of the `vscode` section, and the index needs the
embedder's API key (`openai-compatible` counts as configured only with a base URL and a key) and maybe Qdrant's,
which VS Code keeps in its secret store. The owner wants the index configurable without VS Code as well.

## Fix

- `CODEBASE_INDEX_EMBEDDER_SECRET_KEYS` (`packages/types/src/codebase-index.ts`): the secret of each embedder's key;
  the embedder descriptors read their key through it.
- Mirror: `codebaseIndexConfig` joins `vscode.settings` (the model catalog stays out); `vscode.codeIndexSecrets`
  carries only the active embedder's key and Qdrant's (owner's choice; no other secret is in the section).
- CLI `codeIndex` entry (`CliCodeIndexSettings`): enabled, qdrantUrl, qdrantApiKey(Env), embedder, baseUrl (the
  openai-compatible or ollama server field), model, dimension, apiKey(Env) (the embedder's own secret field),
  searchMinScore, searchMaxResults. `resolveCodeIndexSettings` puts it over the mirrored config and keys, field by
  field, over "off" defaults; an own entry turns the index on unless `enabled: false`; an unset key variable is a
  warning. `findCodeIndexProblems` stops the run on a malformed entry, like `models`.
- The host sends the result as `saveCodeIndexSettingsAtomic` after the settings: the handler the VS Code code index
  settings use saves it, re-initializes the manager and starts or stops indexing.
- The CLI's cache of indexed file hashes is its own, so its first run re-embeds the workspace once; Qdrant point
  ids are content hashes, so nothing is duplicated, and an existing collection takes the incremental path.

## Tests

`cliSettingsMirror.spec.ts` (config mirrored, only the two keys), `code-index-settings.test.ts`,
`extension-host.test.ts` (sent after the settings), `run.test.ts` (handed to the host, malformed entry stops);
mutation-checked.
