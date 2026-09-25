---
"tumble-code": patch
---

Google Vertex profiles keep the credentials JSON you paste into settings: it is now saved in VS Code secret storage with the profile instead of being dropped on save, and a copy left in plain global state by earlier versions is moved into secret storage.
