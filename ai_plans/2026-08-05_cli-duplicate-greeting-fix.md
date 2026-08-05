# Fix: duplicated "Tumble said:" blocks in the CLI (ts-distinct identical text)

Date: 2026-08-05
Branch: `feat/13-cli-duplicate-greeting` (stacked on `rebrand/12-cli-remnant-strings`)
Status: implemented, tests green; follow-up review fixes applied (see below)

## Symptom

In non-interactive / interactive CLI runs, the same assistant reply can be
printed twice as two identical `Tumble said:` blocks, separated by nothing
(or only by interleaved reasoning/sources lines). The user-facing greeting text
is model-generated — there is no literal greeting string in the repo to change.

## Root cause (proven by investigation, with current line numbers)

The extension's streaming pipeline can create two `ClineMessage` entries with
IDENTICAL `text` but DIFFERENT `ts`:

1. [`TaskAskSay.say()`](src/core/task/TaskAskSay.ts:531) gives every new
   partial assistant say its own `Date.now()` timestamp
   ([`TaskAskSay.ts:564`](src/core/task/TaskAskSay.ts:564)).
2. [`presentAssistantMessage.ts:316`](src/core/assistant-message/presentAssistantMessage.ts:316)
   re-presents complete text after finalize via `say(text, ..., block.partial)`.
3. `isUpdatingPreviousPartial`
   ([`TaskAskSay.ts:551`](src/core/task/TaskAskSay.ts:551)) only updates the
   tail when `clineMessages.at(-1)` is a partial text say. When reasoning
   finalize ([`finalizeStream()`](src/core/task/TaskStreamProcessor.ts:532),
   lines 563-579) or grounding sources
   ([`assembleAndSaveAssistantMessage`](src/core/task/TaskStreamProcessor.ts:598)
   line ~614) interleaves between the last text partial and its finalization,
   the tail check fails and a SECOND ts-distinct identical-text message is
   appended ([`TaskAskSay.ts:601-617`](src/core/task/TaskAskSay.ts:601)).
4. The message is persisted & pushed via
   [`TaskHistory.addToClineMessages`](src/core/task/TaskHistory.ts:374) /
   [`updateClineMessage`](src/core/task/TaskHistory.ts:430), which lands in
   the CLI over the shim ([`WindowAPI.ts:226`](packages/vscode-shim/src/api/WindowAPI.ts:226))
   → the CLI's `useExtensionHost` message listener
   ([`useExtensionHost.ts:155`](apps/cli/src/ui/hooks/useExtensionHost.ts:155))
   → [`handleExtensionMessage`](apps/cli/src/ui/hooks/useMessageHandlers.ts:302).
5. The CLI sinks every message twice: the full-array loop over
   `state.clineMessages` ([`useMessageHandlers.ts:325-341`](apps/cli/src/ui/hooks/useMessageHandlers.ts:325))
   AND the individual `messageUpdated` push
   ([`useMessageHandlers.ts:360-378`](apps/cli/src/ui/hooks/useMessageHandlers.ts:360))
   both call `handleSayMessage`, which dedupes ONLY by `ts`
   (`seenMessageIds`, [`useMessageHandlers.ts:85`](apps/cli/src/ui/hooks/useMessageHandlers.ts:85)).
   Two ts-distinct identical entries → two rendered `Tumble said:` blocks.
   The store's `addMessage`
   ([`store.ts:158`](apps/cli/src/ui/store.ts:158)) also dedupes by id (=ts)
   only, so it cannot help.

## Chosen fix: Option 1 (CLI-side, minimal blast radius)

Make the CLI render path dedupe by CONTENT for **consecutive identical
assistant text messages**. In [`handleSayMessage`](apps/cli/src/ui/hooks/useMessageHandlers.ts:59):

- Track `lastAssistantText` (a `useRef<string | null>`).
- Skip a new COMPLETE (`!partial`) `say === "text"` message whose text exactly
  equals the last assistant text we already rendered.
- Update `lastAssistantText` whenever we render an assistant `text` message.

This is implemented at the **single funnel** through which every ClineMessage
becomes a rendered `TUIMessage` — `handleSayMessage` is called by BOTH the
full-array `state` loop and the `messageUpdated` push, so one dedupe point
handles both delivery paths. No other render path bypasses it.

Why Option 1 and not Option 2:

- **Risk to the extension.** Option 2 would change the core
  `isUpdatingPreviousPartial` tail logic in `TaskAskSay.say`, which is
  load-bearing for the VS Code webview's streaming chat. A tail-match loosened
  to "find a prior same-type partial anywhere" risks collapsing genuinely-new
  replies (the tail is intentionally the only safe anchor), and the reasoning
  interleaving is an inherent ambiguity. The regression cost of breaking the
  extension path is far higher than the CLI-only symptom this fixes.
- **Scope.** The duplicate manifests as a _rendered_ duplication in the CLI.
  The underlying double entry in the message array is harmless for the
  extension (its dedupe by ts is correct there) and harmless for persistence;
  only the CLI render collapsed ts-distinct same-text content into two blocks.
- **No over-dedupe.** The skip is exact-match on consecutive assistant text and
  only for completed messages; two replies with different text always render
  (covered by a test). Partial streaming updates still render in real time
  (they flow through `addMessage`'s partial path unchanged).

## Rejected alternative: Option 2 (core-side, fix the root)

Rewriting the tail-mismatch logic in `TaskAskSay.say` so re-presenting text
after interleaved reasoning/sources finalize UPDATES the previous partial
instead of appending a new ts-distinct duplicate. Rejected because we could
not prove with tests that it is safe for the extension path within the scope
of this change, and the existing `TaskAskSay`/`presentAssistantMessage` suites
would not exercise the exact interleaving that caused this bug (they are
streaming-oriented, not interleave-oriented). If the underlying double entry
ever breaks something else (e.g. persist/replay), this becomes the follow-up.

## Regression test strategy

Per `AGENTS.md` (lowest layer that would have failed):

- New `apps/cli/src/ui/hooks/__tests__/useMessageHandlers.test.tsx` — a unit
  test at the hook layer exercising `handleExtensionMessage` with two
  ts-distinct identical text messages, asserting a SINGLE `assistant` message
  in the store:
    1. two ts-distinct identical texts in one `state` push → 1 rendered block;
    2. same-text duplicate delivered separately as `messageUpdated` after the
       full-array loop → 1 rendered block;
    3. **no over-dedupe**: two messages with DIFFERENT text both render (2
       blocks) — dedupe only collapses identical consecutive assistant text.
       Tests model the real "prompt echo is skipped" flow
       (`firstTextMessageSkipped` drops the first text say), so the echo is
       included and the assertions target the actual model reply.
- The existing `ChatHistoryItem.test.tsx` covers rendering of the `Tumble
said:` header itself (updated in the stacked rebrand branch).

## Follow-up (review): cross-turn reset of the dedupe marker

**Reviewer finding:** `lastAssistantText` was never reset, so if the user asks
the SAME question twice and receives byte-identical answers, the second reply
was wrongly suppressed as an in-turn duplicate.

**Fix:** reset `lastAssistantText.current = null` at the start of every new
user turn — exactly in the `say === "user_feedback"` branch of
[`handleSayMessage`](apps/cli/src/ui/hooks/useMessageHandlers.ts:75). That is
the single funnel through which every user message enters the render path, so
it is the one unambiguous user-turn boundary.

Why a user-turn boundary is the RIGHT scope for the dedupe:

- The in-turn duplicate the fix targets exists only WITHIN one assistant turn
  (a partial finalized after interleaved reasoning/grounding gets re-appended
  with a new ts — `TaskAskSay.say` while the model is still responding).
- Across turns, two same-text messages are genuinely different replies and
  must both render; the user-turn boundary is exactly where "same answer,
  second time" becomes legitimate.
- The reset does NOT break in-turn streaming: during a single assistant turn,
  `messageUpdated` partials and the completed same-text duplicate still arrive
  with no `user_feedback` between them, so the ref still holds and the
  duplicate collapse keeps working.
- The user's typed echo passes through unchanged: the echo is dropped by
  `firstTextMessageSkipped`, not by the content dedupe, and resetting the ref
  at `user_feedback` cannot resurrect a duplicate that is already suppressed.

New regression case (4th in `useMessageHandlers.test.tsx`): two byte-identical
assistant replies separated by a `user_feedback` say must BOTH render (2
`assistant` blocks, both `"Same answer"`).

## Companion fix (review): install/upgrade path pointed at the fork

`apps/cli/install.sh` (`REPO="RooCodeInc/Roo-Code"`) still downloaded from
upstream while `apps/cli/src/commands/cli/upgrade.ts` already fetched the
version list from `krzychdre/tumble-code` — breaking `tumble code upgrade`.
Fixed on `rebrand/12-cli-remnant-strings`:

- `apps/cli/install.sh`: `REPO="krzychdre/tumble-code"` (line 16) + usage
  comment URL (line 3). The API/tarball URLs (lines ~103, ~185) derive from
  `$REPO`, so they inherit the fix automatically.
- `apps/cli/README.md`: install instructions at lines 16/33/41 now point at
  `raw.githubusercontent.com/krzychdre/tumble-code/main/apps/cli/install.sh`,
  consistent with the rest of the rebrand.
- `apps/cli/dist/index.js` is NOT tracked (gitignored), so no rebuild was
  required for the committed artifact.
- Verified: `grep -ni "RooCodeInc" apps/cli/README.md apps/cli/install.sh` is
  empty; remaining lowercase "roo" hits are intentional (env var names, paths,
  `@roo-code/vscode-shim`).

## Files changed

- `apps/cli/src/ui/hooks/useMessageHandlers.ts` — content-based consecutive
  dedupe in `handleSayMessage` + cross-turn reset of `lastAssistantText` in
  the `user_feedback` branch.
- `apps/cli/src/ui/hooks/__tests__/useMessageHandlers.test.tsx` — NEW
  regression tests (4 cases; the 4th covers the cross-turn reset).
- `apps/cli/install.sh` / `apps/cli/README.md` — fork repo in installer and
  docs (companion fix on `rebrand/12-cli-remnant-strings`).

- `apps/cli/src/ui/hooks/useMessageHandlers.ts` — content-based consecutive
  dedupe in `handleSayMessage`.
- `apps/cli/src/ui/hooks/__tests__/useMessageHandlers.test.tsx` — NEW
  regression tests (3 cases above).

## Verification

- `cd apps/cli && npx vitest run src/ui/hooks/` — hooks suite (incl. new tests) green.
- Full touched suites: `src/ui/components/`, `src/commands/cli/` (Package A
  strings/URLs + no regressions) — 261 tests green across apps/cli.
