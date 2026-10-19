---
"@tumble-code/cli": patch
---

A `models` entry in cli-settings.json can set `maxConcurrentRequests`, a whole number of 1 or more: how many requests the provider serves for that model at once. It becomes the profile's "Max concurrent requests" in every mode that runs the model, so the subagents started in a mode are capped by the limit of that mode's model. It works with every provider; the example settings file sets it for each model.
