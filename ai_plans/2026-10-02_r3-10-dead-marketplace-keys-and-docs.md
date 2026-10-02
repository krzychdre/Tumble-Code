# R3-10: dead marketplace keys, three i18n surfaces documented, unused-key gate extended to the src tree

Source audit item: `ai_plans/simplification_round3_audit_2026-10-02.md`, finding 10.
Branch: `chore/r3-10-dead-marketplace-keys-and-docs`.

## What the audit said

1. The 16 `filters.*`/`items.*` keys in `src/i18n/locales/*/marketplace.json` are a dead copy of the
   webview locale — no extension code uses them (the host uses only `marketplace:installation.*`).
2. The three i18n surfaces (host locales, webview locales, package.nls) are documented nowhere.
3. The R3-3a unused-key CI gate scans only the webview tree; decide whether to extend it to `src/i18n`.

## Verification before deleting (grep evidence)

- `src/` code references `marketplace:` keys only in
  `src/services/marketplace/MarketplaceManager.ts` (all six `installation.*`) and one
  namespace-only constant in `src/core/webview/messageHandlers/index.ts` (not a key).
- All `marketplace:filters.`/`marketplace:items.` hits outside `i18n/locales` are in
  `webview-ui/src/` — the webview's own separate i18next instance and its own locale copy.
- The audited "16 keys" are exactly the src∩webview key-path intersection of the two
  `marketplace.json` copies (computed, not assumed).

## Decision (c): extend the gate to the src tree — and the audit undercounted

`find-unused-i18n-keys.mjs` was restructured into a per-tree scan (`I18N_TREES` + `loadTree(tree)`):

- `webview` tree: locales `webview-ui/src/i18n/locales`, corpus = whole repository (a webview key
  may legitimately be named by extension-host or CLI code that sends labels to the webview).
- `src` tree: locales `src/i18n/locales`, corpus = `src`, `apps`, `packages` only. The host runs
  its own i18next instance, so webview usage of an identically-named namespace must not keep a
  host key alive — that false negative is precisely what hid the dead marketplace copy.

The first extended scan found **106 dead host keys**, not 16 (all confirmed by grep; the scan's
`--patterns` output was empty, so no dynamic template covers any of them):

| Namespace   | Dead keys | Notes                                                                                                                                                                                                                                             |
| ----------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| marketplace | 37        | the audited 16 + 21 more (`type-group.*`, `item-card.*`, `filters.title`, `filters.sort.lastUpdated`, `filters.installed.label`, `tabs.*`, `done`, `items.empty.emptyHint`) — the whole UI half of the host copy                                  |
| common      | 53        | dead URL-fetch errors (`errors.url_*`, `errors.no_internet`), dead `errors.claudeCode.*`/`roo.*`, `buttons.save`, `answers.no/remove/keep`, `number_format.*_suffix`, `docsLink.*`, `extension.name`, `prompts.deleteMode.*`, `items.zero/one`, … |
| embeddings  | 4         | `validation.invalidEmbedderConfig/invalidApiKey/invalidBaseUrl/invalidModel` — code uses `configurationError`/`apiKeyRequired`/`baseUrlRequired`/`modelNotAvailable` instead                                                                      |
| mcp         | 6         | dead `mcp:errors.invalid_settings_format`, `mcp:info.refreshing_all/all_refreshed/already_refreshing/global_servers_active/project_servers_active`                                                                                                |
| tools       | 6         | dead `readFile.linesRange/definitionsOnly/maxLines`, `codebaseSearch.approval`, `newTask.errors.policy_restriction`, `generateImage.roo.authRequired`                                                                                             |

The mandate said "delete more only if clearly marketplace.\*; anything surprising, report it" — the
69 non-marketplace keys were reported to the owner, who chose: **delete all 106, extend the gate,
make it exit 0**.

## What was done

1. `scripts/find-unused-i18n-keys.mjs`: per-tree scan (`loadTree`, `I18N_TREES`, `reportTree`);
   `--check`, `--write`, `--patterns`, `--missing` all operate per tree; `--missing` stays
   webview-only (the src tree has no equivalent literal-key extractor; its call sites are plain
   `t("ns:key")` strings already visible to the completeness gate).
2. Deleted all 106 keys from all 18 locales via `--write` (1926 entries across all locales,
   including plural variants other languages add).
   `src/i18n/locales/en/marketplace.json` now contains only `installation.*` (43 → 6 keys).
3. `src/i18n/__tests__/i18next-behaviour.spec.ts`: the "returns nested objects" test used the real
   `common:items` plural family as its fixture; it now builds its own resource with
   `i18next.addResource` (`common:__plural_fixture`), so the spec still characterizes the same
   i18next behaviour without pinning product locale keys.
4. `scripts/__tests__/find-unused-i18n-keys.test.mjs`: `loadRepo` → `loadTree`; two new tests —
   the src corpus contains no webview files (the R3-10 invariant), and every English key of both
   trees is referenced (the CI gate's invariant, so `node --test` fails before `--check` does).
5. `docs/architecture.md`: new "Where a string lives" section listing the three surfaces
   (`src/i18n/locales`, `webview-ui/src/i18n/locales`, `src/package.nls.*.json`) and the two CI
   gates, including the per-tree semantics of the unused-key scan.
6. `.github/workflows/code-qa.yml`: unchanged — the existing
   `node scripts/find-unused-i18n-keys.mjs --check` step now scans both trees.

## Verification

- `node scripts/find-unused-i18n-keys.mjs --check` → exit 0 (both trees, 0 unused).
- `node scripts/find-missing-translations.js` → exit 0 ("All translations are complete").
- `node --test scripts/__tests__/find-unused-i18n-keys.test.mjs` → 18/18 pass.
- `cd src && npx vitest run i18n/__tests__/i18next-behaviour.spec.ts __tests__/user-visible-brand.spec.ts
api/providers/__tests__/responses-api-characterization.spec.ts` → 102/102 pass.
- `pnpm knip` → only the two known pre-existing findings (zoo-prs.mjs ×2, .css note); nothing new.

## Deviations from the mandate

- The audit's "16 dead keys" undercounted: 106 were deleted (37 marketplace + 69 others), per the
  owner's explicit choice when the extended scan reported the additional 69.
- One test was rewritten (the `common:items` fixture in `i18next-behaviour.spec.ts`) — required by
  the deletions, behaviour-preserving.
