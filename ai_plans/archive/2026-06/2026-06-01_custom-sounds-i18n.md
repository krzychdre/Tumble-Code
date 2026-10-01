# Fix: complete i18n for custom notification sounds

## Problem

CI job **Code QA / check-translations** (`node scripts/find-missing-translations.js`)
fails. The custom notification sounds feature (commit `fca87d3a0`,
"chore: remove text-to-speech feature; added custom notification sounds (#29)")
added 13 keys under `notifications.sound.custom.*` to the English source file
`webview-ui/src/i18n/locales/en/settings.json` but did not add them to any of the
17 non-English locales. The translation completeness check therefore reports 13
missing keys per locale (221 missing strings total).

## Evidence

```
$ node scripts/find-missing-translations.js; echo $?
...
📝 ca:
  - settings.json: 13 missing translations
      notifications.sound.custom.sectionLabel: "Custom sound files"
      ... (13 keys, repeated for all 17 locales)
1
```

`git log` confirms the keys entered via the custom-sounds commit and no locale
file other than `en` was updated.

## Missing keys (under `notifications.sound.custom`)

`sectionLabel`, `sectionDescription`, `choose`, `preview`, `reset`, `current`,
`tooLong`, `celebration.{label,description}`, `progressLoop.{label,description}`,
`notification.{label,description}` — including the `{{max}}` interpolation token in
`sectionDescription` and `tooLong`.

## Fix

Add a translated `custom` block to `notifications.sound` in each of the 17 locale
`settings.json` files (ca, de, es, fr, hi, id, it, ja, ko, nl, pl, pt-BR, ru, tr,
vi, zh-CN, zh-TW). The block is inserted immediately after `volumeLabel` to keep
key ordering aligned with the English source, and the `{{max}}` placeholders are
preserved verbatim so i18next interpolation keeps working.

## Verification

```
$ node scripts/find-missing-translations.js; echo $?
... ✅ all locales: No missing translations
0
```

## Scope / notes

- Touches only `webview-ui/src/i18n/locales/*/settings.json`.
- Independent of the ClineProvider test fix (separate branch) — that addresses the
  other failing CI job from the same incomplete custom-sounds merge.
