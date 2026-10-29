# A command named like an Object method broke the wrapper lookup

**Status:** fixed on `fix/wrapper-table-own-keys`
**Related:** security audit 2026-10-28, section 24 (follow-up to the wrapper tables of f65e1b095 and #1223)
**Touched:** `src/core/auto-approval/commandWrappers.ts`, `src/core/auto-approval/__tests__/commandWrappers.spec.ts`

## Symptom

`getCommandDecision("toString a", ["*"], ["rm"])` threw `TypeError: options is not iterable`, and so did
`constructor`, `valueOf` and `hasOwnProperty`; `hasOwnProperty -- rm a` could also be read as a wrapper of `rm`.

## What was happening

`unwrapCommand` looked the program up with `name in TABLE`, which is also true for the methods every object inherits,
so `CODE_OPTIONS.toString` (a function) was used as an option list and `SIMPLE_WRAPPERS.constructor` as one.

## Fix

The four lookups (`CODE_OPTIONS`, `RUNNER_SUBCOMMANDS`, `UNWRAPPERS`, `SIMPLE_WRAPPERS`) use `Object.hasOwn`. The
`.rooignore` tables added in section 10 already did.

## Tests

`commandWrappers.spec.ts`: one parametrized row set (`constructor -x a`, `toString a`, `valueOf -n 1 a`,
`hasOwnProperty -- rm a`) decided as ordinary programs. Each of the four lookups put back to `in` turns 3 or 4 rows red.

## Not fixed

Nothing left in this path.
