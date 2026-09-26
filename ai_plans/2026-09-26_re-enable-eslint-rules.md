# Re-enable the ESLint rules disabled during the 2026-09-24 refactor

**Branch:** `chore/re-enable-eslint-rules` (off main @ 7599a8f3f)
**Date:** 2026-09-26
**Scope decision:** re-enable every rule whose disable was a temporary
refactoring exception with a tractable fix; leave off (with justification) only
the rules whose fix would be a massive rewrite — no blanket suppressions.

## Rules re-enabled

### src (extension workspace) — `src/eslint.config.mjs`

| Rule                                    | Findings on main | Fix                                                                                                                                              |
| --------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `no-useless-escape`                     | ~10              | unescape `\/` inside regex character classes, `\"` in template literals                                                                          |
| `no-empty`                              | few              | comments in intentional catch/branch bodies                                                                                                      |
| `prefer-const`                          | ~30              | never-reassigned `let` → `const` (incl. a fake-VS Code terminal in `TerminalCompletionContract.spec.ts` restructured via a `terminalRef` holder) |
| `@typescript-eslint/ban-ts-comment`     | ~20              | `@ts-ignore` → `@ts-expect-error` (all were "access private client" in specs)                                                                    |
| `no-case-declarations`                  | 1                | braces in `presentAssistantMessage.ts`; per-file override removed                                                                                |
| `@typescript-eslint/no-require-imports` | 26               | see below                                                                                                                                        |

### Shared base config — `packages/config-eslint/base.js`

| Rule                             | Findings | Fix                                                                                                         |
| -------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `no-unassigned-vars` (ESLint 10) | 1        | `registerCodeActions.ts` had a dead never-assigned `userInput`; declaration and always-false spread removed |

`preserve-caught-error` (48) and `no-useless-assignment` (39) remain in
`deferredEslint10Rules` — see "Rules left off".

### webview — `webview-ui/eslint.config.mjs`

| Rule                                       | Findings | Fix                                                                                                                                |
| ------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `react/jsx-key` (per-file override)        | 2        | stable `key` props on the two `ModelInfoSupportsItem` array elements in `ModelInfoView.tsx`; ChatRow was already clean after WEB-8 |
| `no-case-declarations` (per-file override) | 2        | braces around the `mostTokens` case in `useTaskSearch.ts`                                                                          |

### Incidental (rules already on, findings on main)

- `packages/types/scripts/publish-npm.cjs`: removed the `/* eslint-env */`
  comment ESLint 10 hard-errors on; the workspace config already sets CommonJS
  globals for `*.cjs`.
- `apps/cli/scripts/integration/cases/mixed-command-ordering.ts`: unescaped
  `\"` in a template literal (`no-useless-escape`).

## `no-require-imports` handling (26 findings on main)

- **16 in `__mocks__`/`__tests__`** → config carve-out for those globs: inside
  `vi.mock` factories a CJS `require` is the correct tool (ESM imports hoist
  out of the factory scope).
- **10 production sites, all deliberate lazy CJS loads** → each now carries an
  `// eslint-disable-next-line @typescript-eslint/no-require-imports` with a
  reason comment:
    - `i18n/setup.ts` (`fs`, `path`): must not enter a browser-facing bundle graph.
    - `integrations/terminal/ShellIntegrationManager.ts`: `os`/`path` hoisted to
      real static imports (no lazy-load justification); the one `fs` require kept
      lazy.
    - `services/tree-sitter/languageParser.ts` (4×): keep web-tree-sitter's WASM
      bootstrap out of module-load time.
    - `services/ripgrep/internal/loadRipgrep.ts`: module exists so `vi.mock` can
      intercept the wrapper (doc comment).
    - `core/webview` spec + `services/search` spec are inside the test carve-out.

## Rules left off (with justification)

| Rule                                                | Count    | Why                                                                                                                                                    |
| --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@typescript-eslint/no-explicit-any` (src)          | 4048     | out of scope: a repo-wide typing campaign; the rule was off since the original ESLint-9 migration (d5484b52f, 2025-05-21), not the 2026-09-24 refactor |
| `@typescript-eslint/no-unused-vars` (src)           | 381      | same history; fixing means deleting/reusing hundreds of variables across core paths — needs its own reviewed change                                    |
| `@typescript-eslint/no-explicit-any` (webview)      | 804      | same                                                                                                                                                   |
| `react/prop-types` (webview)                        | 34       | TypeScript covers prop typing; classic findom rule                                                                                                     |
| `react/display-name` (webview)                      | 26       | mostly false positives on memoized/forwardRef components under the new JSX transform                                                                   |
| `preserve-caught-error` (base, ESLint 10)           | 48       | attaching `cause` changes what callers log/serialize — deserves its own reviewed change                                                                |
| `no-useless-assignment` (base, ESLint 10)           | 39       | dead stores sit in task/condense/diff logic; not mechanical                                                                                            |
| `turbo/no-undeclared-env-vars` (base)               | —        | off since d5484b52f (2025-05-21), pre-refactor and deliberate                                                                                          |
| `react-hooks/*` six compiler diagnostics (react.js) | 61 total | disabled in DEP-7 (#476, 2026-09-26) with measured counts, awaiting per-component refactors; guarded by `scripts/check-react-compiler-bailouts.mjs`    |
| `react/react-in-jsx-scope` (react.js)               | —        | permanently off with new JSX transform                                                                                                                 |
| `no-undef` for `__mocks__`/`.cjs` script globs      | —        | intentional: CommonJS scripts without ESM import scoping                                                                                               |

## Verification

- `pnpm lint` (turbo, 11 workspaces): all green, React Compiler bailout
  baseline unchanged (8 known).
- Targeted vitest for every touched file (run inside each workspace):
  144 + 738 + 61 + 95 + 14 tests, all passing; `apps/cli` `tsc --noEmit` clean
  (the integration case file has no vitest coverage by design).
- `pnpm knip`: output byte-identical to main (A/B in the live tree). Both exit
  1 locally only because of two untracked, gitignored zoo-port skill scripts
  present on this machine; in CI checkouts the tree is clean.

## Known pre-existing issue (not touched)

`webview-ui/vitest.config.ts` imports `../src/utils/vitest-verbosity` across
the workspace boundary (`boundaries/no-relative-import-outside-package`,
warning). Verified pre-existing on main; the fix belongs to the boundaries
work, not this branch.
