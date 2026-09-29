# Too many tools warning: "Don't show again" button

## Request

The chat warning "Too many tools enabled" needs a small button that silences it, at least until the tool count has dropped under the threshold and grown over it again.

## Design

- The click posts the existing `dismissUpsell` message with id `TOO_MANY_TOOLS_DISMISSAL_ID` (`packages/types/src/mcp.ts`). The id lands in the existing `dismissedUpsells` global state list, so no new state key, message type or schema snapshot change.
- `TaskLifecycle.startTask` reads that list. While the id is present and the count is over the threshold, no warning row is emitted. When the count is at or under the threshold, the id is removed, so a later rise warns again.
- `WarningRow` gets an optional `onDismiss`; only `TooManyToolsWarningRow` passes it. The row hides itself at once through local state. A row already stored in an old task's history shows again when that task is reopened (the dismissal is not looked up there).
- New key `chat:tooManyTools.dontShowAgain` in all 18 locales.

## Tests

- `TaskLifecycle.too-many-tools.spec.ts`: warns, stays silent while dismissed, forgets the dismissal under the threshold.
- `TooManyToolsWarningRow.spec.tsx`: click posts the message and hides the row.
- Golden `ChatRow.golden.json` regenerated for the one changed entry.
