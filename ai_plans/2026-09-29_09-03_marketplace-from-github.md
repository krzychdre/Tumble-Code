# Marketplace items from the GitHub repo instead of the cloud API

## Status

Done on branch `feat/marketplace-from-github` (not pushed). Items appear for
users only after the `marketplace/` folder is on `main` of
`krzychdre/Tumble-Code` on GitHub.

## Touched files

- `src/services/marketplace/RemoteConfigLoader.ts`: new fetch flow (GitHub
  contents API listing + raw file download per item).
- `src/services/marketplace/__tests__/RemoteConfigLoader.spec.ts`: rewritten
  for the new flow.
- `src/services/marketplace/__tests__/marketplace-files.spec.ts` (new):
  validates the real files in `marketplace/` at both levels.
- `src/services/marketplace/__tests__/MarketplaceManager.spec.ts`: dropped the
  now-dead `getRooCodeApiUrl` entry from the `@roo-code/cloud` mock.
- `marketplace/README.md` (new): file format and how to contribute a mode.
- `marketplace/modes/docs-writer.yaml` (new): example mode "Documentation
  Writer".
- Stacked on `fix/marketplace-drop-issue-footer`: the Marketplace footer with the
  "Open a GitHub issue" link is deleted there, so this branch no longer touches it.

## Problem

`RemoteConfigLoader` fetched `${getRooCodeApiUrl()}/api/marketplace/modes` and
`/mcps`, each a YAML document `{ items: [...] }`. The fork has no cloud API
serving these endpoints, so the Marketplace was empty or showed an error.
Also, one invalid item made `z.array(...).parse` throw, which emptied the
whole section.

## Design

- Repo layout: `marketplace/modes/<id>.yaml` and `marketplace/mcps/<id>.yaml`,
  one item per file, validated by `modeMarketplaceItemSchema` /
  `mcpMarketplaceItemSchema`. The `type` field is added by the loader.
- Owner, repo, branch and path are named constants at the top of the loader.
- Listing: `GET https://api.github.com/repos/krzychdre/Tumble-Code/contents/marketplace/<type>s?ref=main`
  with `Accept: application/vnd.github+json`. Entries with `type: "file"`, a
  `.yaml`/`.yml` name and a `download_url` are kept.
- Each `download_url` (raw.githubusercontent.com) is fetched in parallel with
  `responseType: "text"` (so axios never tries to JSON-parse it), then
  `yaml.parse` + `safeParse`. An invalid file is skipped with a
  `console.warn` naming the file and the zod issues.
- A 404 on the listing (folder missing, the case for `mcps/` today) returns an
  empty list and is not retried. Any 404 short-circuits the retry loop.
- Kept: 5-minute cache per type, 3 attempts with `backoffDelayMsNoJitter`
  (1 s, 2 s), 10 s timeout, `hideMarketplaceMcps` skipping the MCP fetch.
- `MarketplaceManager` public behaviour is unchanged: it still calls
  `loadAllItems(hideMarketplaceMcps)` and turns a thrown error into
  `errors: [message]`.

## Tests

- `RemoteConfigLoader.spec.ts` (12 tests): listing + per-file fetch with the
  exact URLs and headers, directories and non-YAML entries ignored, invalid
  file skipped with warning, 404 folder -> `[]` with a single listing call,
  `hideMarketplaceMcps`, cache, retry (fake timers), throw after 3 attempts,
  a failed file download is not cached, `getItem`, `clearCache`, expiry.
- `marketplace-files.spec.ts`: loads every `marketplace/modes/*.yaml` from
  disk, validates the item schema, checks `id` equals the file name and the
  name has no emoji, then parses `content` and validates it with
  `modeConfigSchema` exactly like `CustomModesManager.importModeWithRules`
  (after stripping `rulesFiles`), and checks `slug === id`. MCP files, if any
  appear, are validated against `mcpMarketplaceItemSchema`.
- All 7 marketplace spec files pass; `tsc --noEmit` clean; `pnpm knip` exit 0.

## Caveats

- Items appear only after the `marketplace/` folder is on GitHub `main`.
  Until then the modes listing is a 404 and the Marketplace shows an empty
  list without an error.
- The GitHub contents API allows 60 unauthenticated requests per hour per IP.
  With the 5-minute cache the loader makes at most 2 listing calls per
  5 minutes (24 per hour) per extension host; several VS Code windows behind
  one IP share that budget. A 403 rate-limit reply is retried like any other
  error and then surfaces as a Marketplace load error. Raw file downloads are
  not counted against this limit.
- A file whose download fails after retries is skipped, and that result is
  not cached, so the next load tries again. Invalid files (bad YAML or schema)
  are a stable state and are cached like valid results.
- The loader validates only the item level. The mode inside `content` is
  validated at install time by `importModeWithRules`, and for files in this
  repo by `marketplace-files.spec.ts`.
