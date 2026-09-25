---
"tumble-code": patch
---

The Anthropic, Claude on Vertex and MiniMax providers now use the current Anthropic SDKs (`@anthropic-ai/sdk` 0.128, `@anthropic-ai/vertex-sdk` 0.19, with `google-auth-library` 10). Requests, prompt caching and streamed answers are unchanged; when the Google credentials for Claude on Vertex cannot be loaded, the error now still names the reason (for example a missing key file).
