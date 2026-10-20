# Memory notes: the user's words by meaning, not as quotes

**Status:** done on `feat/memory-language-meaning-not-quotes`
**Related plans:** 2026-10-20_23-30_engineering-principles-prompt.md
**Touched:** `src/core/memory/memoryPrompt.ts`, `src/core/memory/extractMemories.ts`, `src/core/memory/autoDream.ts`,
`src/core/memory/__tests__/memoryPrompt.spec.ts`, prompt snapshots.

## Problem

Memory files are written in English because the dream merges duplicates by shared words and finds stale claims by
English markers. Yet three prompts told the model to keep the user's own words verbatim, in quotes, in their original
language. In practice a note in English carried whole Polish sentences, so the notes ended up half in one language and
half in the other, which is the mix the English-only rule exists to prevent.

The owner's decision (2026-10-20): memory files are written entirely in English; the user's words are rendered by
their meaning and their tone, not quoted in the original. A foreign word stays only when the word itself is what the
note is about (for example a rule about a Polish term).

## Change

- `memoryPrompt.ts`, full memory prompt: "Write memory files entirely in English ... Do not quote the user in their
  original language: render the meaning and the tone of their words (firmness, impatience, irony) in English. A word
  in another language stays only when the word itself is the subject of the note."
- `extractMemories.ts`, background extractor (short, for small models): give the user's words by meaning and tone, not
  as quotes in their language.
- `autoDream.ts`, dream merge: translate quoted user words into English by meaning and tone. Old notes with Polish
  quotes therefore turn English as the dream merges them.

KV-cache: one-time prefix invalidation from the memory section of the stable head onward. The extractor and the dream
run as separate requests and do not touch the main prompt's cache.

## Tests

- `memoryPrompt.spec.ts`: the rule is found by its new opening words and must contain the new instruction.
- `extractMemories.spec.ts` and `memoryFiles.spec.ts` assert only the unchanged opening of their rules and pass as
  they are.
- Prompt snapshots updated (24); the only diff is the memory language line.
