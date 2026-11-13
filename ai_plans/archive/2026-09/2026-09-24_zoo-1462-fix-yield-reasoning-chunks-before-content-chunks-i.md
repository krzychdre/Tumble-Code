# Zoo #1462 port: yield reasoning before text when one delta carries both

**Status:** ported, one commit.
**Upstream:** Zoo-Code PR #1462, commit `4e8fa09f2`, merged 2026-09-03, author dw (daewoongoh).
**Touched:** `src/api/providers/{base-openai-compatible-provider,openai,deepseek,lite-llm,qwen-code}.ts`
and their specs (`base-openai-compatible-provider`, `openai`, `deepseek`, `lite-llm`,
`qwen-code-native-tools`).

## Symptom

Reasoning parsers in vLLM, llama.cpp, DeepSeek, Qwen and Z.ai can send the end of the thinking and
the start of the answer in the same streaming delta (`{ reasoning_content: "...", content: "..." }`).
Our OpenAI-family handlers yielded the `text` chunk before the `reasoning` chunk, and the chat then
showed a cut-off answer row and the reasoning twice.

## Root cause in our code

Each handler handled `delta.content` before `extractReasoningFromDelta(delta)`:
`base-openai-compatible-provider.ts:170/176` (also Z.ai, which extends it), `openai.ts:292/298`
(main path) and `openai.ts:583/594` (O3 path), `deepseek.ts:150/159`, `lite-llm.ts:236/240`,
`qwen-code.ts:250/288`.

What that does downstream was traced with a throwaway spec (not committed) that wires the REAL
`TaskStreamProcessor.processChunk`, `presentAssistantMessage` and `TaskAskSay.say` together and
feeds `reasoning "Let me think."`, then one delta, then `text " world"`. The chat rows:

```
text before reasoning (old order)          reasoning before text (new order)
reasoning(partial): "Let me think."        reasoning(partial): "Let me think. Done."
text(partial): "Hello"                     text(partial): "Hello world"
reasoning(partial): "Let me think. Done."
text(partial): "Hello world"
```

`TaskAskSay.say` (`TaskAskSay.ts:551-553`) only updates the last row when it is a partial of the
SAME type. The early text row interrupts the reasoning row, so the tail of the reasoning opens a
second reasoning row (with the whole reasoning again), and the next text opens a second text row.
The first text row stays frozen at "Hello": that is the truncation upstream describes.

## Fix

In each of those handlers, yield the reasoning of a delta before its content. Nothing else changes.
OpenRouter already had this order. LM Studio in our tree reads no reasoning field, so it is
unaffected.

## Tests

One new case per path, a single delta `{ reasoning_content: "thinking...", content: "answer" }` must
produce `[reasoning, text]`: base OpenAI-compatible, OpenAI (main and O3 paths), DeepSeek, LiteLLM,
Qwen Code. All 6 failed before the fix (received `[text, reasoning]`), all pass now.
The whole `src/api` suite: 79 files, 1598 passed, 2 skipped. `tsc --noEmit`, eslint and prettier
are clean.

## Not ported

Zoo's changes to kenari, mimo, nanogpt, opencode-go, requesty and unbound (providers we do not
have or removed), and the Zoo lm-studio change (our LM Studio handler has no reasoning-field path).
