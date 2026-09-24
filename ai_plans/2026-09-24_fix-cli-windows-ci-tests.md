# Fix: four CLI tests fail on the Windows CI runner

Date: 2026-09-24
Branch: `fix/cli-windows-ci-tests` (off `main` at 7be31a426)
Follows: `ai_plans/2026-09-23_fix-ci-test-annotations-log-prefix.md`, which made
these failures visible as named annotations.

## Symptom

The latest Code QA runs on `main` and on PR #197 fail only in
`platform-unit-test (windows-latest)`, and there only in `@tumble-code/cli`.
Ubuntu, compile, knip and translations are green. The job runs
`pnpm test --continue`, so every other package completed and passed on Windows.

| Run                   | Head                 | Failing tests |
| --------------------- | -------------------- | ------------- |
| 35910256736 (main)    | 5845da039 (#196)     | the 4 below   |
| 35982745020 (PR #197) | feature/zoo-1713-... | the same 4    |

Failing tests:

- `src/lib/utils/__tests__/react-production.test.ts`:
  "renders with the production builds, which record no measures" and
  "uses the production builds even when the shell exports NODE_ENV=development, and restores it"
- `src/ui/components/__tests__/McpPanel.test.tsx`:
  "moves the selection with the arrows and shows the tools of a connected server" and
  "says where to add servers when there are none"

## Root cause 1: bare Windows path passed to `import()`

The React build probe starts a child `node --import tsx --input-type=module` and,
when asked to use the helper, runs `await import(process.env.PROBE_HELPER)`.
The test set `PROBE_HELPER` to `path.resolve(...)`. The ESM loader takes a URL,
so `D:\a\Tumble-Code\...\react-production.ts` parses as scheme `d:`. The job log
shows exactly that:

```text
Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only URLs with a scheme in: file, data, and node
are supported by the default ESM loader. On Windows, absolute paths must be valid
file:// URLs. Received protocol 'd:'
```

The control test (no helper, no import) passes on Windows, which matches.

Fix: pass `pathToFileURL(HELPER).href`. The product is not affected:
`src/index.ts` imports the helper statically and loads `./main.js` with a
relative specifier.

## Root cause 2: the test hardcoded a POSIX separator

`McpPanel.tildify()` replaces the home directory with `~` and keeps the rest of
the native path, so on Windows it renders `~\.roo\mcp.json`. The job log frame:

```text
│ searxNcrawl · global · ~\.roo\mcp.json │
│   ~\.roo\mcp.json (every project) or  │
```

The test builds its input with `path.join(os.homedir(), ".roo", "mcp.json")`
(native) but expected the literal `~/.roo/mcp.json`. The panel is right: it
shows a real Windows path, consistent with how it shows every other path.

Fix: build the expected text with `path.join("~", ".roo", "mcp.json")`.

## Verification

- Linux: both files pass (12/12); the whole CLI suite and `pnpm knip` pass.
- Windows: the PR run of this branch on the GitHub Windows runner (see PR).
