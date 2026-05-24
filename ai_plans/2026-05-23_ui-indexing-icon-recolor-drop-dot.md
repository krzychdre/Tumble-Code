# UI: Indexing Icon Recolor + Drop Status Dot - Implementation Plan

**Date:** 2026-05-23
**Branch:** `feature/indexing-icon-recolor`
**Status:** Approved

## 1. Objective

Replace the current "Database icon + colored dot overlay" indexing status indicator with a single `Database` icon whose own color reflects status. Delete the dot overlay entirely. No information is lost — the `animate-pulse` modifier still distinguishes transient states (`Indexing`, `Stopping`) and tooltips already differentiate `Stopping` from `Indexing`.

## 2. Evidence (Current Behavior)

- `webview-ui/src/components/chat/IndexingStatusBadge.tsx:103` — `<Database className="w-4 h-4" />` renders the icon without status-driven color (inherits `text-vscode-foreground` from the parent button at line 98).
- `webview-ui/src/components/chat/IndexingStatusBadge.tsx:104-109` — separate absolute-positioned `<span>` is the colored dot.
- `webview-ui/src/components/chat/IndexingStatusBadge.tsx:76-86` — `statusColorClass` memo maps `systemStatus` to `bg-*` Tailwind utilities (`bg-yellow-500`, `bg-green-500`, `bg-amber-500`, `bg-red-500`, `bg-vscode-descriptionForeground/60`).
- `packages/types/src/vscode-extension-host.ts:717,744` — canonical `IndexingStatus.systemStatus` enum: `"Standby" | "Indexing" | "Indexed" | "Error" | "Stopping"`.
- `webview-ui/src/index.css:143-145` — `text-vscode-charts-{green,red,yellow}` Tailwind utilities already exposed; `vscode-charts-orange`/`-blue` are NOT exposed.
- `webview-ui/src/components/chat/__tests__/IndexingStatusBadge.spec.tsx` — 9 tests; all assert behavior via `aria-label` (tooltip text). None assert specific dot Tailwind classes. One test description (`"renders the status dot"`, line 106) becomes misleading after this change.
- `webview-ui/src/components/chat/ChatTextArea.tsx:1350` — sole consumer of `IndexingStatusBadge`.

## 3. Target Behavior

The `Database` lucide icon adopts a status-driven `text-vscode-*` className. The dot `<span>` is removed. The wrapper button keeps its existing layout, opacity, hover, and focus styles. No new CSS variables, no new tokens.

### Color Map

| systemStatus | Icon className                      | Animation       |
| ------------ | ----------------------------------- | --------------- |
| `Standby`    | `text-vscode-descriptionForeground` | none            |
| `Indexing`   | `text-vscode-charts-yellow`         | `animate-pulse` |
| `Indexed`    | `text-vscode-charts-green`          | none            |
| `Stopping`   | `text-vscode-charts-yellow`         | `animate-pulse` |
| `Error`      | `text-vscode-charts-red`            | none            |

Rationale: VSCode theme tokens auto-adapt to light/dark/high-contrast themes; codebase already uses `text-vscode-charts-yellow` in `TodoListDisplay.tsx`. `Stopping` shares yellow+pulse with `Indexing` and is differentiated by tooltip (`chat:indexingStatus.stopping`).

## 4. Tech Strategy

- **Pattern:** Single-element icon (no overlay composition). Memoized className derivation preserved.
- **State:** Component-local React state (unchanged).
- **Constraints:** VSCode theme tokens only. No new CSS variables. No additions to `index.css`. Clean delete of dot — no commented-out code or backwards-compat shims. The `relative` class on the button can stay (cheap; no positioned children depend on removal) — verify it is not load-bearing for popover positioning before deciding.

## 5. File Changes

| Action | File Path                                                               | Brief Purpose                                                                                                           |
| :----- | :---------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| MOD    | `webview-ui/src/components/chat/IndexingStatusBadge.tsx`                | Rename `statusColorClass` to `statusIconClass`; remap to `text-vscode-*`; apply to `<Database />`; delete dot `<span>`. |
| MOD    | `webview-ui/src/components/chat/__tests__/IndexingStatusBadge.spec.tsx` | Rename test description `"renders the status dot"` to `"renders the status icon"`.                                      |

Blast radius: minimal. One consumer (`ChatTextArea.tsx:1350`), no Storybook, no other component references the dot. i18n strings untouched.

## 6. Risks

- **Contrast/legibility on exotic VSCode themes** — `text-vscode-charts-*` tokens are theme-controlled; high-contrast themes may render bolder. Acceptable; matches existing in-codebase usage in `TodoListDisplay.tsx`.
- **Information density loss** — `Stopping` and `Indexing` share the same visual treatment. Mitigated by tooltip differentiation (already in place at lines 67-68 of the component).
- **`relative` positioning on the button** — Currently kept because the popover trigger sits inside the button and the dot was the only positioned child. After dot removal, `relative` is no longer strictly required but is cheap and may matter for `PopoverTrigger` anchoring. Keep it.

## 7. TDD Steps

The existing 9-test suite covers behavior via `aria-label` assertions. Removing the dot does not change any tooltip-driven assertion. The test description rename is the only test-side change.

1. **Verify clean baseline.** Run the existing suite on `main` → 9 passing.
2. **Create branch.**
3. **Rename the test description** in `IndexingStatusBadge.spec.tsx`. Run suite → 9 passing (no behavior change yet).
4. **Modify the component** — rename memo, swap class mapping, apply to `<Database />`, delete `<span>` dot. Run suite → 9 passing.
5. **Lint + typecheck** the `webview-ui` package.

## 8. Verification Commands

- `pnpm --filter webview-ui test IndexingStatusBadge`
- `pnpm --filter webview-ui lint`
- `pnpm --filter webview-ui check-types`

All three must exit 0 before commit.
