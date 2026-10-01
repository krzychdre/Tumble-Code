# Dead webview UI primitives, their Radix deps and dead CSS (round 2, B3)

Status: done on `chore/webview-dead-ui-primitives`

## Touched files

- Deleted: `webview-ui/src/components/ui/{autosize-textarea,circular-progress,progress,radio-group,table,separator,dropdown-menu}.tsx`,
  `webview-ui/src/components/ui/__tests__/circular-progress.spec.tsx`
- `webview-ui/src/components/ui/index.ts`: `export *` replaced by named exports
- `webview-ui/src/components/ui/__tests__/icons.call-sites.spec.tsx`: the DropdownMenu indicator tests removed with the component
- `webview-ui/package.json`, `pnpm-lock.yaml`: `@radix-ui/react-dropdown-menu`, `@radix-ui/react-radio-group`, `@radix-ui/react-separator` removed
- `webview-ui/src/index.css`: dead selectors removed
- `.changeset/webview-dead-ui-primitives.md`

## Problem

`components/ui/index.ts` re-exported every primitive with `export *`, so knip counted all of them as used through
the barrel. Seven primitives had no user outside `components/ui/` and its tests (checked with `grep -rlw` over
`webview-ui/src`, excluding `components/ui/` and `__tests__`): `AutosizeTextarea`, `CircularProgress`, `Progress`
(the remaining hits are the words "In Progress" and a JSX comment), `RadioGroup`/`RadioGroupItem`, `Table*`,
`Separator` (only a JSX comment in `SkillsSettings.tsx`), `DropdownMenu*`. Three Radix packages were only imported
by these files (plus one spec).

## Fix

1. Deleted the seven files and the spec of `CircularProgress`. The `DropdownMenu item indicators` block of
   `icons.call-sites.spec.tsx` tested only the deleted wrapper, so it went with it.
2. `index.ts` lists named exports. The list was generated from the TypeScript checker (all exports of each module),
   then knip reported 29 re-exports nobody imports through the barrel (for example `buttonVariants`,
   `DialogPortal`, `SelectSeparator`, the `*Props` types); they were dropped from the barrel only. The modules still
   export them, and the callers that need them (`SelectSeparator` in the cloud switchers, `STANDARD_TOOLTIP_DELAY`
   in `App.tsx`, `buttonVariants` in `alert-dialog.tsx`) import the module file directly, as before. knip now sees a
   barrel export that loses its last user.
3. Dependencies: `@radix-ui/react-dropdown-menu`, `-radio-group`, `-separator` removed from `webview-ui/package.json`.
   `@radix-ui/react-progress` stays: `code-index/CodeIndexStatusSection.tsx:2` uses it directly. The lockfile was
   edited by hand (no `pnpm install` allowed in helper worktrees): the three importer entries, then the 11
   `packages` and 11 `snapshots` entries that became unreachable from every importer (the three packages,
   `react-menu`, `react-roving-focus` 1.1.9 and 1.1.11, and older `primitive`, `react-collection`, `react-presence`,
   `react-primitive`, `react-slot` versions only they pulled in). Reachability was computed with a script that walks importers
   and snapshot dependencies; on the `origin/main` lockfile it reports 0 unreachable entries, after the edit also 0.
4. Dead CSS in `index.css`, each selector grepped in the whole repo (webview, host `src/`, packages, CLI), no
   producer found:
   - `.animate-smooth-tumble` (the `smooth-tumble` keyframes stay: `RooHero.tsx:24` sets the animation inline)
   - `@keyframes slide-in-right` + `.animate-slide-in-right`
   - `.custom-markdown > pre`
   - every `.code-block-scrollable` rule (the `.scrollable` halves of the shared selectors stay)
   - `.code-block-scroller pre > code .hljs-addition` / `.hljs-deletion`: the code blocks use Shiki, which writes
     inline colour styles on spans and never these highlight.js classes; `CodeBlock.tsx` only sets
     `hljs language-*` on the `<code>` element; diffs render through `DiffView`, which uses its own classes.

## Tests

- `webview-ui/src/components/ui/__tests__/*` (26 files), `content-blocks.styles.spec.tsx`, `katex-styles.spec.tsx`,
  `DiffView.spec.tsx`: 28 files, 166 tests pass.
- `tsc --noEmit -p webview-ui`: ok (every `@/components/ui` import, specs included, still resolves).
- `pnpm knip`: exit 0.

## Notes / caveats

- The live `node_modules` still contains the three Radix packages until the next `pnpm install`; nothing imports
  them. CI's `pnpm install --frozen-lockfile` is the real check of the hand-edited lockfile.
- Exports that are only referenced inside their own module (for example `CommandShortcut`, which sets its
  `displayName`) are not reported because of `ignoreExportsUsedInFile`; that is knip configuration, not this change.
