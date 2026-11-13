# Replace the `vscrui` dependency with an in-repo component

**Date:** 2026-09-26
**Branch:** `refactor/replace-vscrui`
**Follow-up from:** the 2026-09-24 refactor master plan (dependency cleanup after the React 19.3 / styled-components 6.4 upgrades, which both had to re-verify every remaining webview-ui dependency).

## Motivation

`vscrui` (VS Code React UI, estruyf) is an external package used by the webview UI. It is a styled-components-based library; its 0.2/0.3 releases bundled React 18's `jsx-runtime` (which throws under React 19), and it ships its own CSS-in-JS rather than our Tailwind + VS Code CSS variable conventions. After the React 19.3.0 (#515) and styled-components 6.4.4 (#516) upgrades, it is the last non-Radix component library in the webview bundle. The goal: stop depending on it by replacing only what we actually use.

## Inventory (what is actually used)

A repo-wide search for `vscrui` found exactly **one** exported component in use: `Checkbox`.

| Where                                                                                                                                                                           | Usage                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `settings/R1FormatSetting.tsx`                                                                                                                                                  | `checked` + boolean `onChange`, children as label              |
| `settings/ThinkingBudget.tsx` (×2)                                                                                                                                              | same                                                           |
| `settings/providers/OpenAI.tsx`, `OpenRouter.tsx`, `Anthropic.tsx`, `Vertex.tsx`, `LMStudio.tsx`, `OpenAICompatible.tsx`, `Gemini.tsx` (with `data-testid`), `Bedrock.tsx` (×5) | same                                                           |
| `index.css`                                                                                                                                                                     | `.vscrui-checkbox__listbox` / `.vscrui-checkbox svg` overrides |
| 6 spec files                                                                                                                                                                    | `vi.mock("vscrui", ...)`                                       |
| 1 characterization spec                                                                                                                                                         | pinned the real vscrui markup + React 19 import safety         |

Props surface as used by the call sites: `checked`, `onChange(checked: boolean)`, `children` (label), plus `data-testid` forwarding. `indeterminate` and `disabled` exist in vscrui's `ICheckboxProps` but no call site used them; the replacement supports both anyway (small surface, cheap).

Note: `HistoryView`, `TaskItem`, `DeleteWorktreeModal`, `SkillsSettings` and `CreateSkillDialog` checkboxes come from our own `@/components/ui` (`checkbox.tsx` Radix / `labeled-checkbox.tsx`), **not** from vscrui — they are out of scope.

## Replacement approach

New file: `webview-ui/src/components/ui/vscrui-checkbox.tsx` — `VSCRUICheckbox`, a thin adapter over the existing [`LabeledCheckbox`](../webview-ui/src/components/ui/labeled-checkbox.tsx) (the in-repo replacement for the deprecated toolkit's `VSCodeCheckbox`), keeping vscrui's exact public props API so the diff at call sites is a single import line: `import { VSCRUICheckbox as Checkbox } from "@src/components/ui/vscrui-checkbox"`.

Why an adapter instead of migrating call sites to `LabeledCheckbox` directly: the vscrui API differs (`onChange(boolean)` vs `onChange(event)`), and 10 call sites / 6 spec mocks depend on the boolean form. The adapter keeps the smaller diff and leaves a later, mechanical migration to `LabeledCheckbox` possible.

Why not the Radix [`Checkbox`](../webview-ui/src/components/ui/checkbox.tsx): different API (`onCheckedChange`, no children label), different look (18px toolkit-style vs vscrui 16px) — a bigger behavioral diff for zero benefit.

### Behavior notes / intentional differences from vscrui

- **Look:** `.ui-checkbox` (18px box, VS Code checkbox vars, focusBorder on `:focus-visible`) instead of vscrui's styled-components 16px box. Same VS Code theme variables (`--vscode-checkbox-background/border/foreground`, `--vscode-focusBorder`), so it matches the rest of the settings UI (which already uses `LabeledCheckbox` elsewhere).
- **Label association:** implicit (label wraps input) instead of vscrui's `htmlFor`/`useId` pair — equally accessible: label names the checkbox, Space toggles, clicking the text toggles.
- **`onChange` fires on user input only.** vscrui also fired it from the effect that synced internal state to the `checked` prop; no call site relied on that (all treat it as a user-intent callback).
- **`indeterminate`:** vscrui rendered a dash SVG _instead of_ the check and never set the native `indeterminate` property; the adapter sets the native input property (and keeps the check mark rendering to `LabeledCheckbox`). No call site used `indeterminate`.
- vscrui kept internal state and synced on prop change; the adapter is purely controlled (`checked` prop is the truth). All call sites already treat it as controlled.

### Call-site changes

- 10 files: import line only.
- 6 spec mocks: `vi.mock("vscrui", ...)` → `vi.mock("@src/components/ui/vscrui-checkbox", ...)` with the `VSCRUICheckbox` export key (mock bodies unchanged — they still provide the boolean-onChange contract the tests were written against).
- `R1FormatSetting.vscrui-checkbox.spec.tsx` → renamed to `R1FormatSetting.vscrui-replacement.spec.tsx`; still renders the real component through a real call site, now pinning the `.ui-checkbox` markup instead of the `.vscrui-checkbox` markup. The React-19-import-safety part of its old header comment is obsolete (in-repo TSX now).
- `index.css`: the whole "vscrui Overrides / Hacks" block removed (the `.vscrui-checkbox svg { min-width: 16px }` fix is subsumed by `.ui-checkbox-box`).

## Testing strategy

- New unit spec: `webview-ui/src/components/ui/__tests__/vscrui-checkbox.spec.tsx` — 9 tests: label/input/svg markup, boolean `onChange` (user input only, never on prop sync), `indeterminate` on the native input, `disabled`, `data-testid`/`aria-*` forwarding to the input, Space toggle, ref forwarding, no empty label span.
- Two spec-writing traps hit and fixed (per known webview-ui vitest lore): jsdom's `fireEvent.click` on a disabled input still fires the handler (browsers don't) — assert the `disabled` contract instead; the implicit label association means there is no `for`/`id` pair to assert.
- All existing affected specs (ApiOptions, provider-forms table, Bedrock, Gemini, Vertex, OpenAICompatible, R1FormatSetting characterization) pass with the retargeted mocks.
- No i18next `t` mocking needed for the component spec (no translations in the component).

## Verification

- `cd webview-ui && npx tsc --noEmit` — clean.
- webview-ui lint (via pre-commit `turbo lint`) — clean, 0 warnings after removing an unused `cn` import and 4 unused `testId` destructures the retarget introduced.
- Affected specs: 134/134 pass.
- Full webview-ui vitest suite + `pnpm knip` — run before merge (see PR).
- Residual `vscrui` references: `grep -rn vscrui` over src/package.json/lockfile returns only the new module path and component name.

## Deferred

- None. `indeterminate`/`disabled` were implemented despite being unused (part of the vscrui API surface, near-zero cost).
- Possible future cleanup (not this PR): migrate the 10 call sites from `VSCRUICheckbox` to `LabeledCheckbox`'s event-based `onChange` and delete the adapter — mechanical but touches 10 files + 6 mocks for no functional gain.
