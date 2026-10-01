# Zoo PR #261 — Terminate running process when a task is cancelled

- **Upstream:** Zoo-Code #261 (squash of #245), commit `d96cd4ce0`, merged 2026-05-23 13:25:23Z, author Armando Vaquera.
- **Branch:** `feature/zoo-261-terminate-process-on-cancel` (off `main`).
- **Credit:** `Co-authored-by: Armando Vaquera <263793884+proyectoauraorg@users.noreply.github.com>`.

## Problem

`TerminalRegistry.releaseTerminalsForTask` only disassociated the terminal
(`taskId = undefined`) without aborting a still-running command. So when the user
pressed cancel (✕) — or the task was switched/removed — the process kept running
orphaned and the terminal stayed stuck "busy" until a manual kill.

## Fix (product — `src/integrations/terminal/TerminalRegistry.ts`)

In `releaseTerminalsForTask`, before clearing `taskId`, abort the process if the
terminal is busy:

```ts
if (terminal.busy) {
	try {
		terminal.process?.abort()
	} catch (error) {
		console.error(`[TerminalRegistry] Error aborting process for terminal ${terminal.id} on release:`, error)
	}
}
```

`abort()` is safe when idle (Ctrl+C is gated on an active stream; the abort is
idempotent), and the try/catch ensures a throwing `abort()` never blocks
disassociation. `terminal.busy` and `terminal.process?: RooTerminalProcess` (with
`abort()`) already exist on the fork's terminal type.

## Tests (`src/integrations/terminal/__tests__/TerminalRegistry.spec.ts`)

Append a `describe("releaseTerminalsForTask")` block with 4 cases:

1. busy terminal → `abort()` called once and `taskId` cleared;
2. idle terminal → `abort()` not called, `taskId` still cleared;
3. only the matching task's terminals are released (other task untouched);
4. a throwing `abort()` is swallowed and the terminal is still disassociated.

## Scope / skip

Skip the upstream `.changeset/terminate-process-on-cancel.md` — this fork's port
workflow does not add changesets (none of the prior ported feature branches carry
one; changesets reference the upstream release pipeline). Product fix + tests only.

## Verification

- `npx vitest run integrations/terminal/__tests__/TerminalRegistry.spec.ts` (from `src/`).
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
