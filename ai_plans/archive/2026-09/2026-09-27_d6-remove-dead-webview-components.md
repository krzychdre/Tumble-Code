# D6 — Remove dead webview components & tighten knip rules

Roadmap item D6 from `ai_plans/2026-09-27_simplification-roadmap.md`.
Branch: `feature/d6-remove-dead-webview-components` (off `main` @ `d55078ec7`).

## Goal

Delete dead webview-ui code confirmed unused by the 2026-09-27 read-only audit, then
raise knip `exports`/`types` rules from warn to error **if** the remaining webview-ui
knip output is clean.

## Evidence each target is dead (grep over webview-ui/src, src, apps, packages)

| Target                                                        | Evidence                                                                                                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webview-ui/src/components/ui/select-dropdown.tsx`            | Only references: its own file, its spec, and the barrel `export * from "./select-dropdown"` at `webview-ui/src/components/ui/index.ts:20`. No consumer imports `SelectDropdown`. |
| `webview-ui/src/components/chat/SlashCommandItemSimple.tsx`   | Only references: its own file and its spec. No other import.                                                                                                                     |
| `webview-ui/src/components/chat/BatchListFilesPermission.tsx` | Only references: its own file and its spec. No other import.                                                                                                                     |
| `webview-ui/src/utils/provider-profile-draft.ts`              | Only import is its own spec (`webview-ui/src/utils/__tests__/provider-profile-draft.spec.ts`). Zero production imports → delete file AND spec.                                   |

## Edits

1. `git rm` the 4 dead source files + their 4 spec files (8 files total).
2. Remove the `export * from "./select-dropdown"` line from
   `webview-ui/src/components/ui/index.ts`.
3. Knip: run `pnpm knip` before/after; if webview-ui `exports`/`types` findings are
   gone, raise those categories to `error` in `knip.jsonc`. If unrelated pre-existing
   findings light up, report honestly and scope or leave as-is.
   **Outcome: rules NOT raised.** After the deletions knip still reports 12
   webview-ui unused exports (shadcn barrel re-exports like `DropdownMenu`,
   `DialogTrigger`, `CommandDialog`, `PopoverAnchor`, `SelectLabel`, plus the
   `ProfileViolationWarning`/`TooManyToolsWarning` default-export duplicates) in
   files outside this item's scope. Raising `exports`/`types` to error would fail
   on those pre-existing findings, so `knip.jsonc` is left unchanged. knip exit
   stays 1 = the pre-existing main baseline; zero new findings from this change.
4. Changeset: patch bump (internal refactor).

## Verification

- `cd webview-ui && npx tsc --noEmit` (or workspace typecheck script)
- `cd webview-ui && npx eslint` on touched paths
- `cd webview-ui && npx vitest run` for chat/components/utils suites (or full suite)
- `pnpm knip` from repo root — no NEW findings vs main baseline (which exits 1 pre-existing)

## Acceptance criteria

- 8 dead files gone, barrel export removed; no dangling imports (typecheck green).
- vitest + lint green for webview-ui.
- knip: no new findings; `exports`/`types` raised to error if clean, outcome reported.
- Changeset added; single commit on the feature branch; not pushed.
