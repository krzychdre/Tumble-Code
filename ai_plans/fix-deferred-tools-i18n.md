# Fix: missing `experimental.DEFERRED_TOOLS` translations

## Problem

`EXPERIMENT_IDS.DEFERRED_TOOLS` (`src/shared/experiments.ts:8`) is registered
in `experimentConfigsMap`, so `ExperimentalSettings.tsx` iterates over it and
calls `t("settings:experimental.DEFERRED_TOOLS.name")` /
`...DEFERRED_TOOLS.description`. None of the 18 locale `settings.json` files
have those keys, so the UI shows the raw translation key as the label.

## Root cause

The deferred-tools feature was added on `feat/deferred-tool-loading` (see
`aa18d175a feat(deferred-tools): register tools_load + deferredTools experiment`)
but the corresponding i18n entry in `webview-ui/src/i18n/locales/*/settings.json`
was never created. Sibling experiments (`CUSTOM_TOOLS`, `RUN_SLASH_COMMAND`) all
have the entry.

## Fix

Insert a `DEFERRED_TOOLS` block right after the `CUSTOM_TOOLS` block in each
of the 18 locales. The feature renders through the default
`ExperimentalFeature` branch (no extra UI), so only `name` + `description` are
needed — no sub-keys like `toolsHeader` or `refreshButton`.

### Copy (English)

- name: `Defer tool schemas until needed`
- description: `When enabled, most tools are advertised by name and one-line description only; their full JSON schemas are fetched on-demand via the tools_load meta-tool. Reduces system-prompt tokens for large tool inventories, at the cost of one extra round-trip when a deferred tool is first used.`

Localized text in each settings.json mirrors the tone/length of the
neighboring `CUSTOM_TOOLS` description in that locale.

## Files touched

`webview-ui/src/i18n/locales/{ca,de,en,es,fr,hi,id,it,ja,ko,nl,pl,pt-BR,ru,tr,vi,zh-CN,zh-TW}/settings.json`
