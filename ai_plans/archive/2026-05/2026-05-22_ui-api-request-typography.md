# Normalize "API Request" Typography - Implementation Plan

**Date:** 2026-05-22
**Branch:** `feat/ui-api-request-typography` (stacked from `main`)
**Status:** Approved

## 1. Objective

Make the chat "API Request" status header visually identical (font-size, color,
font-weight) to its sibling status headers ("Thinking", "Running",
"Task Completed", MCP).

## 2. Evidence (traced, not assumed)

All status headers render through `webview-ui/src/components/chat/ChatRow.tsx`
except "Thinking" which renders in `ReasoningBlock.tsx`.

| Header                      | Source                | Styling                                               |
| :-------------------------- | :-------------------- | :---------------------------------------------------- |
| Running (command)           | ChatRow.tsx:287       | `style={{ color: normalColor, fontWeight: "bold" }}`  |
| MCP "wants to use"          | ChatRow.tsx:304       | `style={{ color: normalColor, fontWeight: "bold" }}`  |
| Task Completed              | ChatRow.tsx:315       | `style={{ color: successColor, fontWeight: "bold" }}` |
| Thinking                    | ReasoningBlock.tsx:54 | `className="font-bold text-vscode-foreground"`        |
| **API Request (title)**     | ChatRow.tsx:364       | `style={{ color: normalColor }}` — **NO fontWeight**  |
| **API Request (streaming)** | ChatRow.tsx:368       | `style={{ color: normalColor }}` — **NO fontWeight**  |
| API Request (cancelled)     | ChatRow.tsx:355       | already has `fontWeight: "bold"`                      |
| API Request (failed)        | ChatRow.tsx:366       | `style={{ color: errorColor }}` — **NO fontWeight**   |

`normalColor = "var(--vscode-foreground)"` (ChatRow.tsx:270) is the exact same
token as Tailwind `text-vscode-foreground`. Font-size of all headers is the
inherited default; siblings add no size override, so size already matches.
**Root discrepancy: the three API Request `<span>` variants omit
`fontWeight: "bold"`.**

## 3. Tech Strategy

- **Pattern:** Minimal in-place fix — add the missing `fontWeight: "bold"` to the
  three API Request title spans so they match siblings exactly. No new component;
  the sibling styling is an inline-style convention, not a shared class, so the
  smallest correct change is to apply the identical inline style.
- **Constraints:** Use the exact same `fontWeight: "bold"` value siblings use.
  Do not touch color (already `normalColor`/`errorColor`, matching siblings).

## 4. File Changes

| Action | File Path                                    | Brief Purpose                                                        |
| :----- | :------------------------------------------- | :------------------------------------------------------------------- |
| [MOD]  | `webview-ui/src/components/chat/ChatRow.tsx` | Add `fontWeight: "bold"` to API Request title/streaming/failed spans |

## 5. Execution Sequence

1. Edit ChatRow.tsx:364 (`apiRequest.title`) — add `fontWeight: "bold"`.
2. Edit ChatRow.tsx:368 (`apiRequest.streaming`) — add `fontWeight: "bold"`.
3. Edit ChatRow.tsx:366 (`apiRequest.failed`) — add `fontWeight: "bold"`.

## 6. Blast Radius

Only affects three text spans inside the `api_req_started` icon/title memo.
No layout change (weight only). No tests assert on these inline weights.

## 7. Verification Standards

- [ ] `pnpm check-types` clean in webview-ui.
- [ ] `pnpm lint` clean in webview-ui.
- [ ] Visual: API Request header renders bold, matching Running/Thinking.
