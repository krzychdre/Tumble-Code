---
"tumble-code": patch
---

Diagnostic messages the extension already produced now reach the Tumble Code output channel (View > Output > Tumble Code) instead of being discarded: provider errors such as Bedrock throttling and quota classifications, memory writer failures, and one-off settings migrations. Each line carries a timestamp, the level and the component, for example `2026-09-24T14:05:31.123Z [warn] [bedrock] ...`. Only info level and above is written.
