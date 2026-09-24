---
"tumble-code": patch
---

The CLI spinner now shows two clocks: `total`, the time since you handed the turn to the agent (what the single number used to count), and `step`, the time of the current request to the model including the tools it called. A model that has been thinking for three minutes in one step is now visible as such instead of hiding inside a growing total. Past a minute both read as `16m 16s` instead of `976s`, past an hour as `1h 05m`.
