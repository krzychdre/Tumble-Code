# Zoo #774 port: reasoning effort select no longer goes blank on a stale stored value

**Status:** ported (one commit on wip/zoo-agent-c)
**Upstream:** Zoo-Code PR #774, commit 211d36063, merged 2026-07-01 (author edelauna)
**Touched:** webview-ui/src/components/settings/ThinkingBudget.tsx, webview-ui/src/components/settings/__tests__/ThinkingBudget.spec.tsx

## Symptom

After switching to a model that does not offer the stored reasoning effort (for example "xhigh"
or "max" left over from GPT-5.x/Claude, then a model with only low/medium/high), the
"Reasoning Effort" dropdown in settings shows an empty value. Radix Select renders an empty
trigger when its value matches none of its items.

## Root cause in our code

`ThinkingBudget.tsx` (before the fix, around line 113) computed
`currentReasoningEffort = storedReasoningEffort || defaultReasoningEffort` and passed it straight
to `<Select value>`, without checking it against `availableOptions`. The same happened when the
computed default ("disable") is not in an explicit capability array such as `["low", "high"]`.

## Fix

Clamp the displayed value to `availableOptions`: keep the stored value if the model offers it,
otherwise show the default if offered, otherwise the first offered option (and keep the raw value
only when the list is empty). Also type the options as `ReasoningEffortExtended | "disable"`,
which removes the `as any` / `ReasoningEffortWithMinimal` casts and documents xhigh/max in the
header comment. The xhigh/max labels already existed in our locales.

## Tests

`ThinkingBudget.spec.tsx`, 5 new cases. Before the fix 3 failed:
stale "xhigh" on a required model rendered `data-value="xhigh"` (expected "medium", the model
default), stale "max" on a boolean-support model rendered "max" (expected "disable"), and an
explicit `["low","high"]` array with nothing stored rendered "disable" (expected "low").
After: 26/26 pass; all settings specs 352/352; webview tsc clean; eslint clean.

## Not ported

- Zoo's Select mock rewrite (click-through items) and its xhigh-select test: our mock does not
  need it for these assertions.
- The clamp is display-only here. The stored value is left untouched; persisting the normalized
  value is done by the #1349 port that follows.
