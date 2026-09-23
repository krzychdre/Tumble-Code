---
"tumble-code": patch
---

The CLI settings file takes the context window of a model: `"models": { "GLM-5.3-NVFP4": { "contextWindow": 262144 } }`. An OpenAI-compatible server lists its models without their sizes, so the CLI assumed 128,000 tokens for every one of them and condensed the conversation at about 115,000, however large the model really was. The size applies wherever the model runs (top level, a mode entry or `--model`). The footer's context bar now measures against the same size the condensing uses; for these models it used to measure against 200,000, so it read 60% at the moment the conversation was condensed.
