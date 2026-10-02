# Debug setting description mentions the output panel

Status: done (branch `docs/debug-setting-description`)

## Touched files

- `src/package.nls.json` and the 17 translated `src/package.nls.<locale>.json` files

## Problem

Since #722 (`src/extension.ts:133-157`) the `tumble-code.debug` setting does two things: it shows the debug buttons
in the task header, and it turns on `debug` level lines and the `[perf]` request counters in the Tumble Code output
panel (`setDebugLogging`, `perfCounters.setEnabled`). The setting description in every `package.nls*.json` still
mentions only the buttons, so a user who wants more detail in the output panel has no hint that this is the switch.

## Fix

The English text now says both things; the 17 translations were rewritten in the same style as each locale's
existing line (same verb form, same terms for "debug" and "JSON"), with the output panel named as VS Code names it in
that language.

## Tests

No code changed. `scripts/find-missing-translations.js` reports all translations complete; the user-visible brand spec
(`src/__tests__/user-visible-brand.spec.ts`) passes; prettier is clean.

## Notes

The webview Settings page has its own copy of this text (`webview-ui/src/i18n/locales/*/settings.json`, key under
`debug`), which still mentions only the buttons. It was left out because another helper owns webview-ui in this round.
