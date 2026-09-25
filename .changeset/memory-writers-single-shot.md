---
"tumble-code": patch
---

The memory background writers are much smaller and faster. Saving memories after a task and the periodic memory clean-up each used to start a full agent with the whole agent system prompt, sending 40-60 thousand tokens per request over up to ten requests. Each now asks the model one short question (about 2-3 thousand tokens) and writes the memory files itself, so they also work with small local models. The clean-up never deletes a memory: one it merges away moves to the `.archive` folder inside the memory folder.
