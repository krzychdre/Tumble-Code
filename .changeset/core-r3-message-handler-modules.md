---
"tumble-code": patch
---

Internal: the handler for messages from the chat panel is split from one 3,400-line switch into 16 domain modules behind a lookup table. Behavior is unchanged; a snapshot test pins what each of the 137 message types does.
