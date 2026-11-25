# Microcompaction headroom: select once, then keep the prefix

Status: in review, branch `fix/microcompact-headroom`

## Problem

Microcompaction clears old tool results in the outgoing copy of the request once the context is over the condense
threshold or the allowed tokens (`manageContext`, `src/core/context-management/index.ts`, the pre-pass after
`overCondenseThreshold || overAllowedTokens`). The reclaim target was
`microcompactTargetChars(prevContextTokens - ceilingTokens)`, the overflow times `MICROCOMPACT_TARGET_MARGIN = 1.1`
(`src/core/context-management/microcompact.ts`).

The overflow is usually one turn of growth, so a pass lands just under the ceiling and the next turn is over it again.
The carried-over set (`previouslyClearedIds`, taken first by `selectMicrocompactTargets`) then reclaims less than the
new, slightly larger target, and selection adds the next oldest result. That result sits near the top of the
conversation, so the first changed byte of the request moves back to an old message and the provider's prefix cache is
lost from there: one full re-prefill per turn.

A second effect makes it worse. The char target converts provider-reported tokens with
`MICROCOMPACT_CHARS_PER_TOKEN = 2.5`, which is calibrated against `estimateTokenCount` (tiktoken times
`TOKEN_FUDGE_FACTOR` 1.5, `src/utils/tiktoken.ts`). Against provider tokens a pass therefore removes only about two
thirds of the overflow it aimed at, so even with no growth the next turn can be over the ceiling. The 1.1 margin does
not cover that.

Measured on task `01a20f96` (GLM-5.3 on vLLM, 2026-11-24): in turns 56 to 68 eight requests each cleared one more
old tool result (first differing message index 3, 4, 6, 7, 9, 18, 19, 21 of about 130 to 154) and re-prefilled about
180 000 tokens each, about 1.46 M uncached tokens, roughly 37% of the uncached prompt tokens of the whole 253-request
session. In `ui_messages.json` (counting `api_req_started` rows) the cache reads drop from about 210 000 to between
13 000 and 32 000 on requests 57, 59, 62, 64 and 66 to 70, while the context grows by about 1 000 tokens per turn.

## Fix

Hysteresis, in `manageContext` and `microcompactTarget`:

1. `microcompactTarget(overage, contextWindow)` returns two numbers: `needChars` (the overflow) and `targetChars`
   (the overflow plus `MICROCOMPACT_HEADROOM_FRACTION = 0.1` of the context window).
2. `manageContext` first measures the carried-over selection alone (reasoning trims and cleared tool results
   together, both with target 0). If it covers `needChars`, nothing new is selected and the request is sent with the
   same strip as before, so the prefix is byte-identical. Only otherwise does it select again, down to `targetChars`.
   Reasoning and tool results stay on that one target: reasoning first, tool results for the remainder.
3. Importance protection is released only to reach `needChars` (new `needChars` option of
   `selectMicrocompactTargets`), never for the headroom: critical facts are given up to avoid the lossy condense, not
   to buy cache hits.

Why the carried check is the right gate: TaskApiLoop adds the previous strip (`microcompactStrippedTokens`,
`nextMicrocompactStrippedTokens` in `src/core/task/TaskContextManager.ts`) back to the reported size, so
`prevContextTokens` is the pristine size. The carried set reclaims the same text again, so "carried covers the need"
means "the stripped request is under the ceiling". The early return (`stillOverCondense`/`stillOverAllowed`) then
passes on the same arithmetic and no condense runs.

Why 10% of the window: a pass that selects costs one re-prefill of the whole context (about 180 000 tokens in the
measured task) and clears some extra old output that the model can re-read. For a window of 200k to 262k tokens (the measured
task ran at 210 000 to 222 000), 10% is 20 000 to 26 000 estimated tokens; after the estimator factor above about 13 000 to 17 000 provider tokens of real headroom.
At the measured growth of about 1 000 tokens per turn that is one re-prefill every 13 to 17 turns instead of one every
one or two turns, for clearing about one extra large file read once per cycle. Much larger values would spend more
recoverable context than the cache saves; much smaller ones would bring the per-turn re-prefill back.

## Tests

`src/core/context-management/__tests__/microcompact.spec.ts`:

- New: five consecutive turns of 1 000-token growth over the threshold through `manageContext`. The cleared set is
  chosen on turn 1, stays identical on turns 2 to 4, and on turn 5 (overflow larger than the carried reclaim) grows,
  keeping the first set as its prefix. With the 1.1 margin the set grew every turn.
- New: carried tool results alone covering the overflow keep reasoning untouched (parametrized with the existing
  carried reasoning plus tool case).
- New: protection is released for the need, not for the headroom.
- Adjusted: the target conversion test and the reasoning tests that asserted the 1.1 arithmetic.

Mutation check: headroom 0, always reselecting, and releasing protection to the full target each turn a new test red.

## Not done

The estimator-scale mismatch (provider tokens converted with an estimate-scale chars-per-token ratio) is only
absorbed by the headroom, not fixed. Fixing it would change how every reclaim and the stripped-token correction are
measured; it is a separate proposal.
