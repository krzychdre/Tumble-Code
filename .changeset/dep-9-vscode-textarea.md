---
"tumble-code": patch
---

The multi-line text fields in the Modes view (role definition, when to use, custom instructions, global custom instructions), in the Create New Mode panel and in the Prompts and Context settings no longer come from Microsoft's deprecated webview UI toolkit. They look the same. Fixed on the way: in the Modes view, text you were still typing into a prompt field could be replaced by the old text (and the old text saved) when the extension refreshed the view before you left the field.
