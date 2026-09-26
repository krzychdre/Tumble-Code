# React 19.3 upgrade (chore/react-19-3)

Follow-up item from the 2026-09-24 refactor master plan
(docs/refactor-plan-2026-09-24.md): upgrade React (and ReactDOM +
@types/react/-dom) to the latest 19.3.x across the monorepo.

## Version inventory (before)

| Workspace  | Package          | Before          | After           |
| ---------- | ---------------- | --------------- | --------------- |
| webview-ui | react            | 19.2.3 (pinned) | 19.3.0 (pinned) |
| webview-ui | react-dom        | 19.2.3 (pinned) | 19.3.0 (pinned) |
| webview-ui | @types/react     | ^19.2.0         | ^19.3.0         |
| webview-ui | @types/react-dom | ^19.2.3         | ^19.3.0         |
| apps/cli   | react            | ^19.1.0         | ^19.3.0         |
| apps/cli   | @types/react     | ^19.2.0         | ^19.3.0         |

- No other workspace depends on react/react-dom/@types/react (checked every
  package.json under apps/, packages/, src/, webview-ui/).
- The repo does not use pnpm catalogs (pnpm-workspace.yaml has `packages`
  only), so versions are declared per-workspace.
- apps/cli has no react-dom dependency (ink renders to the terminal).
- 19.3.0 is the latest and only 19.3.x for all four packages (also the npm
  `latest` dist-tag).

## What React 19.3 changes vs 19.2

Source: the official release post (react.dev/blog/2026/09/09/react-19-3).
The release is **additive-only**; no breaking changes, no new deprecations
that affect us:

- **View Transitions**: `<ViewTransition>` and `addTransitionType` are now
  stable (DOM-only). New API, nothing existing touches it.
- **Fragment refs**: ref can now be attached to `<Fragment>`. Additive.
- **react-dom `browser()`**: new entry point bundling canary DOM APIs.
- **Trusted Types support** in react-dom (related to the 2025-12 RSC security
  advisories; we were already on patched 19.2.x).
- RSC-only: `<Context>` renderable directly in Server Components — not used
  here (no RSC in the webview or CLI).

## Peer-dependency check

| Peer                                                                                                                              | Range                                   | 19.3.0 OK?                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| ink 7.1.1 (apps/cli)                                                                                                              | react >= 19.2.0, @types/react >= 19.2.0 | yes                                                                                                      |
| styled-components 6.1.x (webview-ui)                                                                                              | react >= 16.8.0, react-dom >= 16.8.0    | yes — does NOT block React 19.3; the styled-components 6.4 upgrade stays a separate task, untouched here |
| @testing-library/react 16.2/16.3                                                                                                  | react ^18 \|\| ^19                      | yes (no bump needed)                                                                                     |
| ink-testing-library 4.0.0                                                                                                         | @types/react >= 19-ish resolved fine    | yes                                                                                                      |
| Radix / react-i18next / react-markdown / virtuoso / tanstack-query / lucide / cmdk / vscrui / react-use / react-textarea-autosize | all ^16/^17/^18/^19 ranges              | yes — lockfile re-resolved cleanly, no peer warnings                                                     |

## Fixes made

None required. React 19.3 is additive relative to 19.2, and the CLI moved
^19.1.0 → ^19.3.0 which only crosses the already-absorbed 19.2 feature set
(Activity, useEffectEvent, Performance Tracks). Specifically:

- No `act()` warnings, no ref-cleanup-function fallout, no changed
  types that broke tsc in either workspace.
- @testing-library/react 16.2 resolves against 19.3.0 with no peer conflict
  (16.3.0 was pulled in by the lockfile refresh as the latest 16.x).
- styled-components 6.1.18 continues to satisfy its >= 16.8 peer range.

## Verification

- `pnpm install` — clean; only pre-existing unrelated peer warning
  (@lmstudio/sdk wants zod 4, found 3) that exists on main too.
- `cd webview-ui && npx tsc` — 0 errors.
- `cd apps/cli && npx tsc --noEmit` — 0 errors.
- Lint — full `turbo lint` ran via the pre-commit hook: 11/11 tasks
  successful, React Compiler bailout baseline unchanged (8 known).
- `cd webview-ui && npx vitest run` — 219 files, 2955 tests, all passed.
- `cd apps/cli && npx vitest run` — 95 passed + 1 skipped (96 files),
  1299 passed + 1 skipped.
- `pnpm knip` from the main tree — exits 1, but the full output is
  byte-identical to a run against main's content in the same live tree
  (A/B verified): every finding (unused exports in apps/cli agent code and
  src/core, duplicate exports, zoo-port skill scripts) pre-exists on main.
  No new knip findings from the React 19.3 bump; the pre-existing failures
  are handled separately per the 2026-09-24 plan conventions.

## Deferred / notes

- styled-components stays at 6.1.x; its 6.4 upgrade is a separate planned
  task and is not required for React 19.3.
- The webview pins react/react-dom exactly (no caret) by repo convention —
  kept that way at 19.3.0.
- Installed artifacts: the packaged VSIX and the installed CLI bundle
  (~/.roo/cli) need a rebuild/repackage to actually run 19.3 — same as any
  other dependency change; not part of this branch.
