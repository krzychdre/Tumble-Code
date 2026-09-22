# CLI tool approval details

## Root cause

The extension sends interactive `ask: "tool"` messages as JSON containing the tool identifier and its arguments. Before storing the pending ask, the CLI handler replaces that JSON with `formatToolAskMessage(...)` output. The approval dialog then tries to parse the already-formatted text as JSON, fails, and falls back to the generic `Tool use` title with no details. Its existing tool-specific rendering is therefore unreachable in the real interactive flow even though direct dialog tests pass.

## Changes

1. Preserve the extension's raw JSON payload for interactive tool approvals so the approval dialog can identify the tool and render its relevant arguments.
2. Keep follow-up question parsing and non-interactive tool transcript formatting unchanged.
3. Add a handler-level regression test that feeds a real tool ask through the extension-message path and verifies that the pending approval retains the structured payload used by the dialog.

## Verification

- `cd apps/cli && npx vitest run src/ui/hooks/__tests__/useMessageHandlers.test.tsx src/ui/components/dialogs/__tests__/ApprovalDialog.test.tsx` — 17 tests passed.
- `cd apps/cli && pnpm test` — 619 tests passed, 1 skipped.
- `cd apps/cli && pnpm check-types` — passed.
- `cd apps/cli && pnpm lint` — passed.
