---
"tumble-code": patch
---

The single-line text fields (provider settings, codebase index, modes, history search, cloud sign-in, profile rename, cost and request limits) no longer come from Microsoft's deprecated webview UI toolkit. They look and behave the same, including selecting the whole text when a rename field opens. Fixed on the way: in the Modes view, a mode description (and the other fields that save when you leave them) could lose what you were typing and save the old text when the extension refreshed the view before you left the field.
