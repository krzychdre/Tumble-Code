---
"tumble-code": patch
---

S2 refactor: extracted the tool-call stream-event loop (`StreamToolCallHandler`) and the assistant-message assembly for API history (`AssistantMessageAssembler`) out of `TaskStreamProcessor`, which stays as the chunk-dispatch coordinator. Pure move — throttling, tool-call-id pairing and message upsert ordering are unchanged, no spec assertions changed.
