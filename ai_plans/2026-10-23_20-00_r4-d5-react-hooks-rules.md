# R4 D5: five react-hooks compiler rules back on

**Status:** done

**Related plans:** [maintenance audit round 4](2026-10-23_17-20_maintenance-audit-round-4.md), item D5.

## Touched files

- `packages/config-eslint/react.js`, `webview-ui/react-compiler-bailouts.json`
- `webview-ui/src/App.tsx`, `webview-ui/src/hooks/useScrollLifecycle.ts`,
  `webview-ui/src/components/common/MermaidButton.tsx`, `webview-ui/src/components/code-index/useCodeIndexSettings.ts`,
  `webview-ui/src/components/history/TaskDetails.tsx`,
  `webview-ui/src/components/settings/providers/OpenAICodexRateLimitDashboard.tsx`
- Specs: `ExtensionStateContext.messages.spec.tsx`, `CommandExecution.spec.tsx`,
  `OpenAICodexRateLimitDashboard.spec.tsx`, `CodeIndexPopover.sections.spec.tsx`,
  `hooks/__tests__/useScrollLifecycle.spec.ts` (new)

## Problem

`react.js` kept six React Compiler rules off. After D1 to D4, five of them had a handful of findings left:
`globals` (1, a spec), `purity` (3, `Date.now()` in render), `immutability` (4), `preserve-manual-memoization`
(2, both caused by the immutability finding in App), `refs` (7). Four of the files were React Compiler bailouts.

## Change

- **globals:** the messages spec's probe reports through a module function instead of assigning module variables
  in render.
- **purity:** TaskDetails reads "now" once per row (`useState(Date.now)`); the Codex rate-limit dashboard counts the
  time to a reset from when the limits arrived (`receivedAt`, set in the message handler). Both match what the
  compiled components already did, since the compiler memoized those expressions on their inputs.
- **immutability / preserve-manual-memoization:** App declares `currentSection` and `currentMarketplaceTab` before
  `switchTab` uses them. useScrollLifecycle splits the self-calling `finishHydrationWindow` into
  `finishHydrationWindow` (first end: retry once if not at the bottom) and `endHydrationWindow` (anchor and clear);
  the retry flag is gone because the first end runs once per window. CommandExecution.spec seeds its mock state in
  `beforeEach` instead of in the wrapper's render.
- **refs:** MermaidButton copies the rendered diagram into state when the modal opens instead of reading the
  container ref in render; useCodeIndexSettings updates its settings ref in an effect; useScrollLifecycle builds the
  debounced smooth scroll in an effect and keeps it in a ref.
- `react.js` keeps only `set-state-in-effect` off. App, MermaidButton, useCodeIndexSettings and useScrollLifecycle
  now compile; the bailout baseline drops from 6 to 2 (McpExecution, DiffView).

## Tests

- `useScrollLifecycle.spec.ts` (new): a task not at the bottom scrolls once more after the hydration window and then
  anchors; taller rows at the bottom scroll smoothly once per burst. Mutations (no anchor at the end, the smooth
  scroll never installed, debounce without the leading call) each turned a case red.
- Dashboard spec: the time to a reset counts from arrival (red when `receivedAt` is not set).
- CodeIndexPopover.sections: a successful save keeps the typed value (red when the settings ref is not updated).
- MermaidButton spec goes red when the modal gets no diagram HTML.
- Touched specs plus history, code-index, ChatView, context and App specs green; `eslint src` in webview-ui with
  `--max-warnings=0`, tsc and the bailout check (2 known) pass.
