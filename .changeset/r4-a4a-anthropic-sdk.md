---
"tumble-code": patch
---

The Anthropic and Anthropic Vertex providers use SDK 1.x, which sends API version 2026-10-21. That version rejects `temperature`, so the custom temperature setting no longer reaches Anthropic or Vertex Claude models (MiniMax still gets it). API keys keep going out in `X-Api-Key`, so gateways behind a custom base URL see no change.
