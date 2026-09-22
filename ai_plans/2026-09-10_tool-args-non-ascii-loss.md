# Fix: Polish diacritics stripped from tool-call arguments (Task Completed block)

**Date:** 2026-09-10
**Branch:** `fix/tool-args-non-ascii-loss` (off `main` @ 428cdbfb3)
**Status:** ROOT CAUSE PROVEN FROM TASK DATA → mitigation shipped.

## What the user saw

In the "Task Completed" block of the completion window, Polish diacritics were
gone: `zwyky` (→ zwykły), `wic` (→ więc), `pula wtkw` (→ pula wątków),
`dziaa` (→ działa), `pami/1769` (→ pamięci/1769 — two ASCII chars `ci` lost
alongside the diacritics). The same task's streamed assistant **text** was
flawless.

## Evidence trail (all from task 01a08b54, profile `GLM-5.3-Flash`)

1. `ui_messages.json` `say:completion_result` — damaged (diacritics stripped,
   no replacement character).
2. `api_conversation_history.json` — the **same turn's** assistant `text`
   block: perfect diacritics; assistant `tool_use.input` blocks: stripped.
   Both channels arrive on the SAME SSE stream.
3. Files written during the task (`fix-plan-pl.md`, `us-template-pl.md`) are
   damaged the same way — the damage enters via tool args, not rendering.
4. Cross-task scan (all tasks, damaged-Polish-pattern in tool args):
   concentrated in this one GLM-5.3-Flash task; other profiles (incl. local
   GLM-5.3-NVFP4 serving the same model) produce Polish tool args with
   intact diacritics across dozens of tasks.
5. Client decode path is byte-safe: the OpenAI SDK `LineDecoder`
   (`openai@5.12.2`) buffers raw bytes and decodes only complete lines; UTF-8
   continuation bytes never contain `\n`, so a split codepoint survives the
   chunk boundary. No stripping filter exists anywhere in
   `NativeToolCallParser` / `TaskStreamProcessor` (verified by read).

## Root cause

The serving backend behind the `GLM-5.3-Flash` profile (an OpenAI-compatible
endpoint on a remote box) loses non-ASCII bytes **only in the tool-call
arguments channel** of the SSE stream. The `text` channel of the same stream
is intact, and the same model served locally (llama.cpp/vLLM path) does not
do this. Damage pattern (position-dependent loss, occasional survivors like
"usług") matches lossy decoding of fragmented multi-byte UTF-8 inside the
backend's tool-args pipeline. The bug is upstream of the client; we cannot
fix the backend, only stop feeding it raw non-ASCII in that channel.

**Why the completion block specifically?** (user's note: "czy przyczyna leży
w sposobie uznania końcowej wiadomości jako tool-call?") — No, classification
is not the problem. In native tool-calling the completion text IS a tool-call
argument by design: the model emits `attempt_completion{"result": "..."}`, so
its text flows through the backend's tool-args serialization path, not the
`delta.content` path. The same task's streamed prose (earlier assistant
messages, reasoning) travels as `delta.content` and arrives perfect — that
asymmetry within ONE stream is what pins the damage to the backend's
tool-args channel. Nothing in our code "decides" the final message is a
tool call; the model called a tool and the completion lives in its
arguments. Any tool argument with Polish text (write_to_file content,
apply_diff, todos) was damaged identically, which confirms channel- not
message-level damage.

## Mitigation

**What this is NOT:** a claim that diacritics in tool arguments are
impossible. They work — 18 of 35 GLM-5.3-Flash completions in this repo's
history carry intact diacritics, and even inside the damaged task 3 of 117
tool args survived with Polish characters. The backend corrupts non-ASCII
args _intermittently_, not deterministically. Intermittent is worse than a
hard wall: you cannot detect it, so you cannot trust the channel.

**What this is:** JSON spells every non-ASCII character two ways — the
literal form `"ł"` (raw UTF-8 bytes) and the escape `"\u0142"` (pure ASCII).
They are the _same string_ after `JSON.parse`; no information is lost, the
user sees identical diacritics either way. Given one unreliable spelling and
one reliable spelling of the same character, the prompt now asks the model
for the reliable one.

System prompt, TOOL USE section
([tool-use.ts](../src/core/prompts/sections/tool-use.ts)): instruct the model
to encode every non-printable-ASCII character in JSON tool arguments as a
`\uXXXX` escape. JSON escapes are pure ASCII, pass the damaged channel
untouched, and `JSON.parse` on the client decodes them back — the user still
sees real diacritics in the final text. The instruction is unconditional
(all modes/profiles) because the section is part of the KV-cache-stable
prefix; a per-profile switch would fragment the prefix for every other
backend that does not need it.

Accepted trade-off: escaped arguments are slightly longer (6 bytes per
escaped char vs 2 for Polish letters in UTF-8) and slightly less readable in
raw logs. Token cost is negligible relative to a 60k-token prompt.

Guard tests ([tool-use.spec.ts](../src/core/prompts/sections/__tests__/tool-use.spec.ts))
assert the instruction exists and that the section itself stays
printable-ASCII (it is part of the cached prefix; a literal diacritic here
would both defeat the mitigation's spirit and add multi-byte noise to the
prefix).

## Snapshot updates

7 full-prompt snapshots gained the new paragraph (pure additions, no other
changes): prefix-stability/canonical-code-prompt, system-prompt/consistent +
with-mcp-hub + with-undefined-mcp-hub, add-custom-instructions/ask + architect

- mcp-server-creation-disabled.

## Residuals

- If a model ignores the instruction and emits raw UTF-8 args, the damage can
  still occur — acceptable; GLM follows format instructions well, and the
  fallback failure mode is unchanged from today.
- The backend bug should be reported to whoever serves GLM-5.3-Flash on that
  endpoint (sm120/DGX Spark box) — this fix only avoids the trigger.
- An aggressive `safeEncodeNonAsciiInArgs` post-parse repair is NOT possible:
  the bytes are already gone when we parse; nothing to recover.
