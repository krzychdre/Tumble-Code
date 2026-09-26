---
"tumble-code": patch
---

Selecting a mode no longer wipes its MCP server restriction list, and switching to a profile without a custom temperature no longer stores an empty temperature. Both came from the old checkboxes, which reacted to a setting loaded from elsewhere as if you had clicked them. Checkboxes now come from the extension itself instead of Microsoft's deprecated webview UI toolkit. They look and behave the same, with two small fixes: a checkbox always shows the saved state (it could briefly show a click the settings did not accept), and its box keeps its full size next to a long label that wraps.
