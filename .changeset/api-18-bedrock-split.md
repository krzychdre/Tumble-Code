---
"tumble-code": patch
---

Amazon Bedrock requests behave exactly as before; internally the Bedrock provider now builds the request, reads the response stream and maps errors in separate, individually tested modules instead of one long function.
