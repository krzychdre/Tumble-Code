---
"tumble-code": patch
---

Fixed: **Mermaid diagrams in chat no longer keep links or click actions.** Diagrams written by the model render in Mermaid's strict mode, so a `javascript:` link or a click callback in the diagram text is dropped instead of becoming part of the chat view.
