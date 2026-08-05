# Abort crash in `handleError` → `say("error")` re-throw

## Symptom

The CLI (and the extension under the same path) crashes hard on every task
abort while a tool is mid-execution, e.g. when `ask_followup_question` is
in-flight and the user cancels (ESV / stop):

```
Error: [RooCode#say] task 019fd1fd-… aborted
    at TaskAskSay.say (…/TaskAskSay.ts:545)
    at handleError (…/presentAssistantMessage.ts:610 or 232)
    at AskFollowupQuestionTool.execute (…/AskFollowupQuestionTool.ts:77)
    at async AskFollowupQuestionTool.handle
    at async presentAssistantMessage
```

## Root cause

The crash is a re-throw chain, not a missing guard at the throw site:

1. User aborts → `this.access.abort = true`
   ([TaskLifecycle.ts:580](../src/core/task/TaskLifecycle.ts#L580)).
2. `AskFollowupQuestionTool.execute` calls `task.ask("followup", …)`
   ([AskFollowupQuestionTool.ts:72](../src/core/tools/AskFollowupQuestionTool.ts#L72)).
   `ask()` checks `access.abort` and throws a plain `Error`
   `"[RooCode#ask] task … aborted"`
   ([TaskAskSay.ts:90](../src/core/task/TaskAskSay.ts#L90)).
3. The tool's `catch` hands it to `handleError("asking question", error)`
   ([AskFollowupQuestionTool.ts:77](../src/core/tools/AskFollowupQuestionTool.ts#L77)).
4. `handleError` only swallows `AskIgnoredError`
   ([presentAssistantMessage.ts:605](../src/core/assistant-message/presentAssistantMessage.ts#L605)
   and :228). An abort `Error` is **not** an `AskIgnoredError`, so it
   proceeds to **report** the error by calling
   `await cline.askSay.say("error", …)` (line 610 / 232).
5. `say()` re-checks `access.abort` at the top
   ([TaskAskSay.ts:544](../src/core/task/TaskAskSay.ts#L544)) — still true —
   and throws `"[RooCode#say] task … aborted"`.
6. That throw is inside `handleError`, an async function with no surrounding
   try/catch at that call site. It rejects back up through `execute` →
   `handle` → the `await askFollowupQuestionTool.handle(…)` in
   `presentAssistantMessage` (line 867) → unhandled → process crash.

The abort `Error` thrown by `ask`/`say` is a **plain `Error`**, so the only
existing discriminator (`instanceof AskIgnoredError`) never matches it, and
the reporter (`say`) is itself abort-gated — so reporting an abort always
re-throws.

This is not specific to `ask_followup_question`: any tool whose `execute`
calls `task.ask`/`task.say` and routes failures through `handleError` will
crash the same way on abort. `ask_followup_question` is just the most common
trigger because it blocks on `ask` every turn.

## Fix

Make `handleError` treat an abort-state error as a no-op, identically to
`AskIgnoredError`, **before** it tries to report via `say`. The reliable
discriminator is the live abort flag on the task (`cline.abort`), not the
error's shape (the thrown `Error` carries no marker, and matching on the
message string would couple to an internal log format).

Both `handleError` closures in `presentAssistantMessage.ts` (the MCP one at
:225 and the core-tool one at :602) get the same guard, since either can be
the reporter for an aborting tool.

```ts
const handleError = async (action: string, error: Error) => {
    // Silently ignore AskIgnoredError - internal control flow signal.
    if (error instanceof AskIgnoredError) {
        return
    }
    // Silently ignore errors raised while the task is aborting. ask()/say()
    // throw a plain abort Error when access.abort is set, and reporting it
    // via say() would re-throw (say() is itself abort-gated), crashing the
    // process. The abort is intentional — nothing to surface to the user.
    if (cline.abort) {
        return
    }
    const errorString = `Error ${action}: ${JSON.stringify(serializeError(error))}`
    await cline.askSay.say("error", `Error ${action}:\n${error.message ?? …}`)
    pushToolResult(formatResponse.toolError(errorString))
}
```

### Why the flag and not a typed error

- The thrown abort `Error` is a bare `new Error("[RooCode#say] … aborted")`
  with no subclass or marker; introducing an `AbortError` class would be a
  larger change touching `TaskAskSay.ts` throw sites and every existing
  abort-aware catch. Out of scope for a crash fix.
- Matching on `error.message` would couple to an internal log string and
  break the moment that message is reworded.
- `cline.abort` is the same flag the throw sites read, so the guard is
  self-consistent: if the flag is set, the error is by construction an
  abort signal and there is nothing to report.

## Verification

- New unit test in `askFollowupQuestionTool.spec.ts`: when `task.ask`
  rejects with an abort-shaped `Error` AND `mockTask.abort` is true, the
  tool's `execute` resolves (does not throw) and `handleError` is still
  invoked with the error — i.e. the tool still routes through `handleError`,
  but `handleError` no longer re-throws. (Existing tests mock `handleError`
  as a bare `vi.fn()` that returns `undefined`, so they pass today and keep
  passing; the new test exercises the real `handleError` closure.)
- New unit test covering the real `handleError` closure with `cline.abort`
  true: calling `handleError` with a non-`AskIgnoredError` error must NOT
  call `askSay.say` and must NOT throw.
- Repro confirmation: the original crash stack is gone — `handleError`
  returns before reaching `say("error")`.

## Scope

One file changed in source:
`src/core/assistant-message/presentAssistantMessage.ts` (two closures).
