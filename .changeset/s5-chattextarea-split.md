---
"tumble-code": patch
---

Internal cleanup of the chat input box, with no visible change: the "@" and "/" suggestion menu, the highlighting of mentions and commands, the row of mode and API configuration selectors, and the send, stop, queue, enhance and image buttons now live in their own hooks and components instead of one 1,300-line file. The selector row now re-renders only when its own settings change.
