---
"@roo-code/vscode-webview": minor
---

Replace the external `vscrui` dependency with an in-repo `VSCRUICheckbox` component. `vscrui` was only used for its `Checkbox` in the settings provider forms; the new component is a thin adapter over the existing `LabeledCheckbox` with the same props API (`checked`, `indeterminate`, `disabled`, boolean `onChange`, children as label), so call sites only changed their import line. Drops the `vscrui` package and its CSS overrides.
