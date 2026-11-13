# R1: keep a corrupt task history file instead of overwriting it

Item R1 of `2026-09-27_simplification-roadmap.md`.

## Problem

`readApiMessages` and `readTaskMessages` returned `[]` when the task's `api_conversation_history.json` or
`ui_messages.json` did not parse or was not an array. The task then saved its new, nearly empty history to the
same path, destroying whatever the damaged file still held.

## Change

- New `src/core/task-persistence/quarantineCorruptFile.ts`: renames the file to `<name>.corrupt-<timestamp>` and
  logs an error. It never throws.
- Both readers call it for a parse error and for a non-array value, then return `[]` as before, so the eight
  callers are unchanged.
- A read error (for example a permission error) is not corruption: `readTaskMessages` still returns `[]` without
  moving the file.

## Tests

`apiMessages.spec.ts` and `taskMessages.spec.ts`: an unparseable file (including an empty one) and a non-array
file are moved aside with their original bytes; a valid file stays in place. The four new cases fail without
the fix.
