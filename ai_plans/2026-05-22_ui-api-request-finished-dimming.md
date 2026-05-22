# Remove Finished-State Dimming from "API Request" Header — Implementation Plan

**Date:** 2026-05-22
**Branch:** `fix/ui-api-request-finished-dimming` (stacked on `feat/ui-monospace-tool-containers`)
**Status:** Approved

## 1. Objective

Once an API request finishes, the "API Request" status header renders at 40%
opacity and only returns to full opacity on hover. This makes it look dimmer
(reported as a "different color") and behave differently from sibling headers
("Thinking", "Running", etc.), which are always full-opacity. Make the API
Request header always render at full opacity with no hover-driven opacity
change — visually identical behaviour to its siblings.

## 2. Evidence (traced, not assumed)

`webview-ui/src/components/chat/ChatRow.tsx`, `case "api_req_started"`, header
container `<div>`:

```
className={`group text-sm transition-opacity ${
  isApiRequestInProgress ? "opacity-100" : "opacity-40 hover:opacity-100"
}`}
```

When `isApiRequestInProgress` is false (request finished) the whole container
gets `opacity-40 hover:opacity-100`:

- `opacity-40` → the entire block (icon + title + timestamp + cost) renders at
  40% opacity → reads as a dim gray = the reported "different color". The text
  token is unchanged (`var(--vscode-foreground)`); only opacity differs.
- `hover:opacity-100` → the block jumps to full opacity on mouse hover = the
  reported "reacts to hover".

`ReasoningBlock.tsx` ("Thinking") header container is
`flex items-center justify-between mb-2.5 pr-2 cursor-pointer select-none` — no
opacity dimming, no whole-block hover. Other ChatRow headers (MCP, completion)
have no wrapping opacity-40 div. `api_req_rate_limit_wait` already uses a
constant `opacity-100`.

**Root cause: the `opacity-40 hover:opacity-100` finished-state class on the
API Request header container.**

## 3. Tech Strategy

- Replace the conditional className with a constant `"group text-sm"` — always
  full opacity, no opacity transition. `transition-opacity` is dropped (nothing
  transitions opacity anymore). `group` is retained (harmless; consistent with
  the sibling rate-limit header).
- `isApiRequestInProgress` remains used (`BlockTimestamp endTs`, same block) so
  there is no unused-variable regression.
- **Branch placement note:** this fix cannot live on
  `feat/ui-api-request-typography` standalone — removing that branch's only use
  of `isApiRequestInProgress` would leave the variable unused (its second
  consumer, `BlockTimestamp endTs`, is introduced only on
  `feat/ui-block-timestamps`), failing `check-types`. It is therefore delivered
  as a fix branch stacked on the tip, completing the feature-1 intent.

## 4. File Changes

| Action | File Path                                    | Brief Purpose                                                 |
| :----- | :------------------------------------------- | :------------------------------------------------------------ |
| [MOD]  | `webview-ui/src/components/chat/ChatRow.tsx` | API Request header: constant full opacity, drop dimming/hover |

## 5. Execution Sequence

1. Edit ChatRow.tsx `api_req_started` container className → `"group text-sm"`.

## 6. Blast Radius

Single className on one div. No layout change (opacity only). The cost badge
keeps its own independent `opacity` style. No tests assert on this class.

## 7. Verification Standards

- [ ] `pnpm check-types` clean in webview-ui.
- [ ] `pnpm lint` clean in webview-ui.
- [ ] Visual: finished API Request header is full-opacity, identical to
      Thinking; no opacity change on hover.
