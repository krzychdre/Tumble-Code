# R4 A3 (3/5): webview UI libraries, patch and minor updates

**Status:** done.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md` (item A3).
**Touched files:** `webview-ui/package.json`, `pnpm-workspace.yaml` (catalog `react`, `i18next`), `pnpm-lock.yaml`,
`webview-ui/src/components/ui/__tests__/tooltip.spec.tsx`,
`webview-ui/src/components/common/__tests__/MermaidButton.spec.tsx`, the lucide and ChatRow golden files and two
provider-form snapshots.

## Change

| Package                                               | From            | To             |
| ----------------------------------------------------- | --------------- | -------------- |
| @radix-ui/react-alert-dialog, -collapsible, -progress | 1.1.x           | 1.2.1          |
| @radix-ui/react-dialog, -popover                      | 1.1.13          | 1.3.1          |
| @radix-ui/react-portal                                | 1.1.8           | 1.2.0          |
| @radix-ui/react-select                                | 2.2.4           | 2.4.1          |
| @radix-ui/react-slider                                | 1.3.4           | 1.6.1          |
| @radix-ui/react-slot                                  | 1.2.2           | 1.5.0          |
| @radix-ui/react-tooltip                               | 1.2.6           | 1.4.1          |
| @tanstack/react-query                                 | 5.76.1          | 5.104.5        |
| lucide-react                                          | 1.48.0          | 1.61.0         |
| mermaid                                               | 12.0.0          | 12.2.0         |
| shiki                                                 | 4.4.3           | 4.5.0          |
| react-virtuoso                                        | 4.12.7          | 4.18.19        |
| tailwind-merge                                        | 3.3.0           | 3.7.0          |
| i18next, react-i18next                                | 26.4.2, 17.0.15 | 26.5.6, 17.1.4 |
| date-fns, lru-cache                                   | 4.1.0, 11.1.0   | 4.4.0, 11.5.3  |
| react-use, unist-util-visit                           | 17.6.0, 5.0.0   | 17.6.1, 5.1.0  |
| @testing-library/react, user-event                    | 16.3.0, 14.6.1  | 16.3.3, 14.6.8 |
| react (catalog, webview and CLI), react-dom           | 19.3.0          | 19.3.1 (exact) |

Library behaviour that the specs saw:

- Radix Tooltip 1.4 puts `role="tooltip"` on the visible content and no longer renders a visually hidden copy.
  `tooltip.spec.tsx` reads the tooltip with `getByRole("tooltip")` instead of filtering the copy out.
- Radix DismissableLayer 1.2 dismisses a dialog on the click that ends a primary-button press, not on the
  pointerdown. `MermaidButton.spec.tsx` sends pointerdown and click on the overlay, as a real click does.
- Radix Select and Popover triggers drop `aria-controls` while closed (it pointed at content that was not in the
  DOM). The ChatRow golden and the provider-form snapshots lose that attribute; nothing else changed in them.
- lucide 1.61 redraws `Brain`. The lucide golden also gains `Hourglass`, imported since #911 but missing from the
  golden, which made the spec red on `main` already.

## Tests

- Whole `webview-ui` suite with `--maxWorkers=2`: 264 files, 3844 tests green; `tsc --noEmit` green.
- `apps/cli` `src/ui` (70 files, 793 tests, ink on React 19.3.1) and `src` `i18n` green.
- Mutation: dropping `max-w-[300px] break-words` from `TooltipContent` turns two tooltip tests red.
