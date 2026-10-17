---
"tumble-code": patch
---

Amazon Bedrock no longer sends the "xhigh" reasoning effort to Claude models when no effort level is chosen in the settings. The request now leaves the field out, so the model runs at its own default level, which is the level the settings show as "(model default)". A level chosen in the settings is still sent as before.
