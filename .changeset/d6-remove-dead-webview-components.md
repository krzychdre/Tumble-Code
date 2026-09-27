---
"@roo-code/vscode-webview": patch
---

Removed dead webview components that had no production consumers: the unused select-dropdown UI component (and its barrel export), SlashCommandItemSimple, BatchListFilesPermission, and the test-only provider-profile-draft utility, along with their specs. No behavior change.
