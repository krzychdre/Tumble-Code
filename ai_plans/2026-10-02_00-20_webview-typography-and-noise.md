# Webview typography and noise (D6)

Status: done on `refactor/webview-typography-and-noise` (PR open, not merged). Stacked on
`chore/webview-small-leftovers` (same Modes, settings and chat files).

## Touched files

- Headers: `components/common/Tab.tsx` (new `TabTitle`), `settings/SettingsView.tsx`, `history/HistoryView.tsx`,
  `marketplace/MarketplaceView.tsx`, `settings/SectionHeader.tsx` (`actions` slot), `modes/ModesViewHeader.tsx`,
  `modes/ModesView.tsx`
- Type scale: `index.css` (`--text-title`), `modes/{ModeCustomInstructionsSection,CreateModeDialog}.tsx`,
  `common/TabButton.tsx`, `chat/UpdateTodoListToolBlock.tsx`, `settings/providers/{OpenAICompatible,Bedrock}.tsx`,
  `chat/QueuedMessages.tsx`, `ErrorBoundary.tsx`
- Corners: 85 component files (173 `rounded*` classes removed), `index.css`, `scripts/check-webview-radius.mjs`,
  `docs/05-webview-ui.md`, `history/{TaskItem,TaskGroupItem}.tsx` (a prop that only chose a radius)
- Spinner: `components/ui/spinner.tsx` (replaces `themed-progress-ring.tsx`), `App.tsx`, `SettingsView.tsx`,
  `chat/{ProgressIndicator,CheckpointWarning,ComposerActionButtons}.tsx`, `common/CodeAccordion.tsx`,
  `cloud/CloudView.tsx`, `worktrees/{WorktreesView,CreateWorktreeModal,DeleteWorktreeModal}.tsx`,
  `settings/{CustomToolsSettings,providers/LiteLLM}.tsx`, `marketplace/MarketplaceListView.tsx`,
  `ui/icon-button.tsx`; `common:loading` in 18 locales
- Specs: `ui/__tests__/spinner.spec.tsx` (was `progress-ring.call-sites.spec.tsx`), `SettingsView*.spec.tsx` mocks,
  `ChatTextArea.spec.tsx`, ChatRow golden, `provider-forms.openai-native` snapshot

## Problem

(a) Settings tabs use `SectionHeader` (`settings/SectionHeader.tsx`), but the Modes page drew its own title
(`ModesViewHeader.tsx:33`, `h3 text-[1.25em] mt-4 mb-2`, not sticky, help text below in another style), and the
three full-page views each built their back arrow and title by hand (`SettingsView.tsx:405-413`,
`HistoryView.tsx:111-123`, `MarketplaceView.tsx:92-103`) with different classes (one `font-bold`, one with
`aria-label` and `sr-only`, one wrapped in a tooltip).

(b) Font sizes in five units: the theme already has a scale on `--vscode-font-size` (`text-xs/sm/base/lg`,
`index.css:48-52`) but call sites used `text-[13px]` (10), `text-[1.25em]` (2), `fontSize: "12px"` (14, 7 of them
info icons in settings), `text-md` (3, not a Tailwind class, so a no-op).

(c) Corners were zeroed twice (the `@theme` radius tokens and a utilities block for `rounded` / `rounded-full`,
which do not read the tokens) while 173 `rounded*` classes in TSX did nothing. The UI-1 design
(`ai_plans/2026-09-27_ui-modernization.md:8`) is "square corners everywhere, no pills"; no inline radius exists
(`check-webview-radius.mjs` already rejects them), so every one of the 31 `rounded-full` (status dots, the slider
thumb, the hero glow, radio inputs) already rendered square.

(d) Four loading indicators: `ThemedProgressRing` (5), a spinning `codicon-loading` (7), `animate-spin` on a sync
codicon or the prompt-enhance wand (2), lucide `Loader2` (2). The ring announced itself as an assertive
"Loading" alert in English everywhere, also in every running chat row.

## Fix

(a) `TabTitle` in `common/Tab.tsx`: back arrow (name from an `sr-only` label, optional tooltip, optional test id)
plus an `h3` with `text-lg font-bold`. The three views use it. `SectionHeader` gets an `actions` slot and a
`ReactNode` description; the Modes page renders its title, buttons and help text through it, outside the `Section`
body like every other settings tab, so it is sticky with the same padding.

(b) `--text-title` (1.25 x the VS Code font size) joins the scale for section headings. `text-[13px]` becomes
`text-base`, the settings info icons use `text-xs` like the other info icons there, the no-op `text-md` is removed.
Left as they are: em sizes that are relative on purpose (`text-[0.9em]` in mentions and search rows), icon glyph
sizes (`fontSize: 16` on codicons), the MCP view's inline sizes (restyled in the density item stacked on this one),
and the badge font size in `ExpandableToolRows` (changed by the open select/badge PR).

(c) All `rounded*` classes are removed (a script removed the class tokens in class strings only, the result was
reviewed line by line; empty `cn` entries and `className=""` left behind were dropped). The radius tokens in
`@theme` stay as the single zeroing mechanism; the utilities block is gone. `scripts/check-webview-radius.mjs`, which
already runs in the webview `lint` script, now rejects any `rounded*` class outside specs and comments, so a new
one cannot come back silently.

(d) `Spinner` (`components/ui/spinner.tsx`): the same ring and CSS as before, sized by the call site. With
`label` it is `role="status"` named by the label (polite); without one it is `aria-hidden`. Labelled call sites
translate at the call site (`common:loading`): the lazy tab fallbacks in `App` and `SettingsView`, the worktree
list, `CodeAccordion`. Spinners next to visible text ("Creating...", "Refreshing models") and the chat row
`ProgressIndicator` (the row title says what runs) are decorative. The primitive does not import the translation
context, which keeps it usable in the 20 specs that mock react-i18next without `initReactI18next`.
`ProgressIndicator` is now one 16px spinner instead of a 28px ring scaled to 0.55 inside a 16px box (same box, the
row height does not change). The prompt-enhance wand is replaced by the spinner while enhancing.

## Tests

- 201 spec files that import a touched component: pass, except `HistoryView.a11y.spec.tsx` "day headers" (fails
  after midnight, date-dependent, also on main).
- `spinner.spec.tsx`: labelled status, decorative without label, the two pinned call sites.
- ChatRow golden regenerated: removed `rounded*` classes, the `ProgressIndicator` markup (6 renders: wrapper divs
  gone, `aria-hidden` instead of the alert), the `CodeAccordion` status. No layout-affecting change.
- `check-webview-radius.mjs`, `check-react-compiler-bailouts.mjs`, `find-missing-translations.js`, tsc, eslint,
  knip: clean.

## Notes

- `TabTitle` h3 is `text-lg` (1.1 x font size, about 14.3px) where the browser default h3 was 1.17em (about
  15.2px): about one pixel smaller, now on the scale.
- `SettingsView.spec.tsx` mocks `common/Tab` with a spread of an un-awaited `vi.importActual` (a Promise, so it
  spreads nothing); the new `TabTitle` export got its own stub there.
