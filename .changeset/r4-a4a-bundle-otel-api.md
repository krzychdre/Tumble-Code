---
"tumble-code": patch
---

Fix: the extension bundle now includes `@opentelemetry/api`, which the Anthropic SDK 1.x loads at startup. Before, a packaged VSIX built after the SDK 1.x upgrade could not load that module.
