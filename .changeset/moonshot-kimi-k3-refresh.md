---
"tumble-code": patch
---

The Moonshot (Kimi) provider lists the models Moonshot still serves: Kimi K3 (new default), Kimi K2.7 Code, Kimi K2.7 Code HighSpeed and Kimi K2.6. Every model it listed before (kimi-k2-0905-preview, the old default, kimi-k2-0711-preview, kimi-k2-turbo-preview, kimi-k2-thinking and kimi-k2.5) was discontinued by Moonshot by 2026-08-31. These models fix temperature server-side and reject any value, so no temperature is sent any more. Kimi K3 always reasons; its reasoning effort (low, high or max, the API's default) can be chosen in the settings and is sent as `reasoning_effort`. Kimi K3 costs $3 input and $15 output per million tokens, against $0.60 and $2.50 for the old default. A model id that is not in the list is sent with the K2.6 info, so it gets no reasoning effort the K2 line does not accept. A saved id of a discontinued model is not changed and fails at Moonshot as before; pick a listed model in the settings.
