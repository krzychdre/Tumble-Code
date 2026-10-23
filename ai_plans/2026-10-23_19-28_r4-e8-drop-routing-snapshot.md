# R4 E8: the webviewMessageHandler routing snapshot is retired

- **Status:** done
- **Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (item E8, owner decision: delete
  entirely)

## Touched files

- `src/core/webview/__tests__/webviewMessageHandler.routing.spec.ts` (deleted, 791 lines)
- `src/core/webview/__tests__/__snapshots__/webviewMessageHandler.routing.spec.ts.snap` (deleted, 3870 lines)
- `src/core/webview/messageHandlers/__tests__/registry.spec.ts` (header comment)
- `src/core/webview/messageEnhancer.ts` (comment on the `MessageEnhancer` facade)
- `docs/architecture.md`, `docs/02-extension-host.md`

## Problem

The routing spec snapshotted the side effects of one representative message per routed type. It existed to prove
that the CORE-R3 split of `webviewMessageHandler` into domain modules only moved code. The split is done, and the
snapshot had become a change detector on every handler: any legitimate change to a handler rewrote it.

## Change

- The spec and its snapshot are deleted.
- "Every routed type has exactly one handler" stays covered by `messageHandlers/__tests__/registry.spec.ts`, which
  also pins the number of routed types. The behaviour of single handlers is covered by their own specs.
- The docs and the two comments that pointed at the routing spec now name only `registry.spec.ts` (or nothing).
  The `MessageEnhancer` facade stays: `messageHandlers/enhanceAndSearch.ts` still calls it.

## Tests

- `./node_modules/.bin/vitest run core/webview/messageHandlers/__tests__/registry.spec.ts core/webview/__tests__/messageEnhancer.test.ts --maxWorkers=2`: 20 passed.
- Mutation check: dropping the first domain group from the `messageHandlers` merge in `messageHandlers/index.ts`
  turns the registry count test red; restored afterwards.
