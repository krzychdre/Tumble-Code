---
"tumble-code": patch
---

The webview lint rule against setting state synchronously in an effect is on again; the last components that did it now update their state while rendering.
