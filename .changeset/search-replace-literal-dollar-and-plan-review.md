---
"tumble-code": patch
---

The `search_replace` tool (used by xAI Grok models) now writes `$` sequences such as `$$`, `$&`, `` $` `` and `$'` exactly as the model sent them instead of expanding them, and it pauses for plan review after editing a plan file like the other write tools.
