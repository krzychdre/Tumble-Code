---
"tumble-code": patch
---

Vertex now always runs a profile with no model chosen on the Claude handler, because the default model is Claude Opus 5; before, it sent the Claude model id to the Gemini API, which cannot serve it. A model id that Tumble Code does not list is now sized with a model of its own kind: an unknown Claude id still uses Claude Sonnet 4.5, and an unknown Gemini id now uses Gemini 2.0 Flash instead of a Claude record, so it no longer gets Claude's output limit, prices or a thinking budget that older Gemini models reject. Listed models behave exactly as before.
