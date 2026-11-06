# CLI: load each command's module when it runs (audit C-8)

**Status:** done on `perf/sec-cli-startup`
**Audit:** `private_docs/security-audit-2026-11-06/report.md` C-8 (CO-3 judged here too)
**Touched:**

- `apps/cli/src/main.ts`: no static import of `@/commands/index.js`; each action imports its own module (`commands/cli/run.js`, `list.js`, `upgrade.js`, `doctor.js`, `commands/auth/openai-codex.js`, `cloud.js`); the run action awaits `loadReactProductionBuilds()` first
- `apps/cli/src/index.ts`: no React preload
- `apps/cli/src/lib/utils/react-production.ts`: comment names `main.ts`
- `apps/cli/src/commands/index.ts`, `commands/cli/index.ts`, `commands/auth/index.ts`: deleted (no importer left)
- tests: `src/__tests__/argument-parser.test.ts`, `flag-defaults.test.ts` mock the per-command modules and the preload

## Problem

`index.ts` imported React, react/jsx-runtime and ink before parsing arguments, and `main.ts`
statically imported every command (and with `run.ts` the agent and React), so `--version`,
`--help`, `doctor`, `upgrade`, `list` and `auth` paid for the TUI's module graph.

## Measured (worktree tsup build, `node dist/index.js`, 7 runs, median)

| command          | before | after  |
| ---------------- | ------ | ------ |
| `--version`      | 261 ms | 170 ms |
| `doctor`         | 293 ms | 225 ms |
| `upgrade --help` | 264 ms | 174 ms |

Floor for a bare `--version` print is about 34 ms; most of the remaining ~135 ms is the
`@tumble-code/types` chunk (zod schemas, about 1 MB) that `loadSettings` in `index.ts` and
`types/constants.ts` in `main.ts` need, left as is.

The bundle's static chunks (index, main, settings and their imports) hold no React; React, the
jsx runtime and ink load only from the run action, after the preload. `--print` without a key
reports the same error as the installed CLI.

## CO-3 (not changed)

`probeTerminalGraphics` returns at once inside a multiplexer (`insideMultiplexer`) and ends its
wait as soon as the DA1 reply arrives (`parseProbeReplies(data).complete`); only a terminal that
answers no DA1 at all waits the 400 ms. A cache keyed by TERM would need invalidation for no
measured case.
