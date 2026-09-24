# Zoo #968 port: architect mode names the plans directory as workspace-relative ./plans

**Status:** ported, one commit on the Zoo port stack.
**Upstream:** Zoo-Code PR #968, commit `dfb8d6963` (merged 2026-07-25), author Toray Altas.
**Touched:** `packages/types/src/mode.ts`, `packages/types/src/__tests__/architect-plans-directory.spec.ts`,
5 snapshots under `src/core/prompts/__tests__/__snapshots__/`.

## Symptom

The architect mode ends its instructions with "put it in the /plans directory". Models read
`/plans` as an absolute filesystem path and try to create it at the filesystem root, which fails
with `EROFS: read-only file system, mkdir '/plans'`. Weak models (GLM, Qwen, local Llamas) take
paths literally, so they are the most affected.

## Root cause in our code

`packages/types/src/mode.ts:219`, the last sentence of the architect `customInstructions`:
`put it in the /plans directory`.

## Fix

The sentence now reads: "put it in the ./plans directory, relative to the workspace root (for
example plans/feature-plan.md). Do not use the absolute path /plans." It names the relative form,
gives a concrete path in the shape the file tools expect, and forbids the absolute form in a
separate short sentence. The rest of the mode text is unchanged.

## Tests

New `packages/types/src/__tests__/architect-plans-directory.spec.ts` (2 cases) failed before the
fix (the text contained "the /plans directory" and no relative form) and passes after.
Five prompt snapshots were updated with `-u`; the diff is exactly the one changed sentence in each.
`packages/types`: 299/299 tests, tsc clean. `src/core/prompts/__tests__`: 129/129. eslint and
prettier clean.

## Not ported

Nothing functional. Zoo's wording ("a directory named "plans" relative to the workspace root, not
the absolute filesystem path /plans") was replaced by a shorter one with an example path.
