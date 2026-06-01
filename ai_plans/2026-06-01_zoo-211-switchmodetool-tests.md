# Zoo PR #211 — Add unit tests for SwitchModeTool

- **Upstream:** Zoo-Code #211, commit `bff1e7603`, merged 2026-05-20 23:06, author Roomote.
- **Branch:** `feature/zoo-211-switchmodetool-tests` (off `main`).
- **Credit:** `Co-authored-by: Roomote <roomote@roocode.com>`.

## Change

Test-only PR. Adds `src/core/tools/__tests__/switchModeTool.spec.ts` (357 lines, 17 tests)
covering the class-based `SwitchModeTool` (`BaseTool` architecture): mode-slug validation
(valid/invalid/missing), already-in-mode handling, error propagation from mode loading, the
approval flow + params, delegation to `handleModeSwitch`, success messages for both paths,
custom-mode support, and partial-message streaming via `task.ask`.

No product code. Our fork already ships the class-based `SwitchModeTool.ts`,
`BaseTool.ts`/`ToolCallbacks`, and `switchModeTool` instance — the tests exercise existing
behaviour.

## Compatibility note (fork divergence)

Our `SwitchModeTool` carries a fork-specific addition absent upstream: it stamps a
`toolCallId` into the `switchMode` approval/partial JSON payloads (native tool-call dedup).
The upstream tests assert the payloads _without_ `toolCallId`. This is safe because in every
test scenario the id is `undefined` (`createBlock` sets no `block.id`; `mockCallbacks`
provides no `toolCallId`), and `JSON.stringify` drops `undefined`-valued keys — so the
serialized payloads match the upstream expectations byte-for-byte. The test ports verbatim;
no adaptation needed.

## Approach

1. Copy the upstream spec verbatim to `src/core/tools/__tests__/switchModeTool.spec.ts`.
2. Run it against our existing `SwitchModeTool` — passes (validates behavioural parity).

## Verification

- `npx vitest run core/tools/__tests__/switchModeTool.spec.ts` → 17/17.
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
