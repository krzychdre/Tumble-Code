---
"tumble-code": patch
---

When a tool fails, the model now receives only the error message (and the message of its cause, if any) instead of the full serialized error with its stack trace. The stack wasted context on every failure, exposed local file paths, and tended to distract weaker models from the actual problem. The stack is still written to the log, and the error shown in the chat is unchanged.
