# CLI: run the doctor checks at the same time (audit C-9)

**Status:** done on `fix/sec-cli-misc`
**Audit:** `private_docs/security-audit-2026-11-06/report.md` C-9
**Touched:**

- `apps/cli/src/commands/cli/doctor.ts`: `runDoctor` awaits all checks with `Promise.all`, results in the given order, a throwing check still becomes a failed line
- `apps/cli/src/commands/cli/__tests__/doctor.test.ts`: concurrency and order case

## Problem

`runDoctor` awaited the checks one by one; the ripgrep probe (5 s timeout) and the cloud probe
(3 s) then added up to 8 s on a broken machine, which is when users run `doctor`.

## Fix

`Promise.all` over the checks, each wrapped in its own try/catch as before. The checks are
independent (Node version, bundle, ripgrep, MCP config, cloud). The second `loadSettings()` call is
kept: one small JSON read (about a millisecond), and the two checks treat a broken file
differently (the MCP check reports it, the cloud check falls back to the default URL).

## Tests

A first check that waits until the second one has started: passes only when both run at once,
and the report lists them in the given order. With the serial loop it never finishes (red by
timeout).
