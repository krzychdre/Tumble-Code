# R4 D2: settings rows for ContextManagementSettings (and TerminalSettings)

**Status:** done

**Related plans:** [maintenance audit round 4](2026-10-23_17-20_maintenance-audit-round-4.md), item D2.

## Touched files

- `webview-ui/src/components/settings/SettingRows.tsx` (new)
- `webview-ui/src/components/settings/ContextManagementSettings.tsx`
- `webview-ui/src/components/settings/TerminalSettings.tsx`
- `webview-ui/src/components/settings/__tests__/ContextManagementSettings.spec.tsx`

## Problem

ContextManagementSettings spelled nine settings rows by hand (four sliders, five checkboxes), the two image-size
fields and the tool-result budget field were a third shape copied three times, the "unlimited" expression of
the diagnostics slider was written four times, `listApiConfigMeta` was `any[]` with `|| []` guards for a value
SettingsView always passes as `?? []`, and two `t(...) || "English"` fallbacks could never apply.
TerminalSettings spelled six checkbox rows the same way.

## Change

- `SettingRows.tsx`: `CheckboxRow`, `SliderRow` and `NumberRow`, each a `SearchableSetting` with label,
  description and test id in the place every settings tab puts them. `NumberRow` ignores input outside
  `[min, max]` (NaN fails the range check). They are shared because two tabs use them.
- ContextManagementSettings uses them for eleven rows; the diagnostics slider stays hand-written (reset button,
  aria text) with `DIAGNOSTICS_SLIDER_UNLIMITED`, `diagnosticsUnlimited` and `diagnosticsSliderValue` computed once.
  `listApiConfigMeta` is `ProviderSettingsEntry[]` without guards; the dead English fallbacks are gone; the
  CONDENSE prompt editor has one setter (the textarea never passes undefined). The checkbox labels are spans, so
  no `<label>` sits inside the checkbox's own `<label>`. The file goes from 634 to 467 lines; the condensing
  section (profile threshold select, compaction profile select) is the rest and has no repeated shape.
- TerminalSettings uses `CheckboxRow` for its six checkbox rows (the inherit-env row also posts a VS Code
  setting and stays as it is). Prettier reformatted the file's indentation.
- All `data-testid` values are unchanged (checked by diffing the id lists).

## Tests

- New in `ContextManagementSettings.spec.tsx`: a slider row stores the moved value; a number row stores an
  in-range whole number and ignores 0, 101 and "abc". Mutations in `SettingRows.tsx` (no upper bound, no lower
  bound, slider change not forwarded, checkbox change not forwarded) each turned a case red; dropping the `isNaN`
  check stayed green, so it was removed as redundant.
- All `src/components/settings` specs green; tsc, eslint and the React Compiler bailout check pass.
