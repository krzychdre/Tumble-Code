---
"tumble-code": patch
---

Optional tool parameters stay optional after a request to an OpenAI-compatible provider. Converting the tool list for OpenAI strict mode used to rewrite the shared tool definitions in place, so after the first such request parameters like the working directory of `execute_command` or the mode of a follow-up suggestion no longer accepted `null` for every later request in the session, including requests to other providers after a mode switch. What is sent to OpenAI-compatible providers is unchanged.
