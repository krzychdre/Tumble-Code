# CLI: heap out of memory during long reasoning (React development performance tracks)

**Status:** done on `fix/cli-oom-react-dev-perf-tracks` (off `main` `e6256e334`), committed, not pushed
**Touched:** `apps/cli/src/index.ts` (now a bootstrap), `apps/cli/src/main.ts` (the former `index.ts`, unchanged),
new `apps/cli/src/lib/utils/react-production.ts` + test

## Request

The TUI (`tumble --reasoning-effort high`, GLM-5.3-NVFP4) died twice on 2026-09-23 with
`FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`,
after 1237 s and 1577 s, both times with `∴ Thinking…` on screen. "Analyse and fix."

## What was measured

**Task data** (`~/.vscode-mock/global-storage/tasks/`). The two tasks are `01a0ce4e` (news summaries,
14:47:54 to about 15:08) and `01a0ce74` (review of a diff, 15:29:10 to 15:55:13). In both, the last
persisted message is a `say: reasoning` with `partial: true` and one word ("I", "The"): the crash
came during a reasoning stream (about 9 min 47 s and 2 min 40 s long). The on-screen `↓ 15.4K` /
`↓ 111.3K` equal the sums of `tokensOut` of the finished requests, so the running stream is not
counted in them. Task 2 had 464K characters of finished reasoning (single blocks up to 91K) that
had not crashed on their own, so something accumulated across the whole session.

**The core dump.** apport kept the second crash: `/var/crash/_usr_bin_node.1000.crash`
(`Date: Wed Sep 23 15:55:13 2026`), a 5.1 GB core after `apport-unpack`.

- `strings -n 200` (one-byte strings) found only 30 MB. `strings -e l -n 200` (UTF-16, V8's
  two-byte strings, used for any text with a character above U+00FF) found 1.49 G characters,
  about 3 GB: the whole heap.
- They were the task's reasoning blocks, each copied thousands of times at growing lengths, as
  JSON string literals (leading and trailing `"`, `\n` escaped). The block starting
  `"The doc fetching is proving unreliable` had 6441 copies, 1074 distinct lengths (about 6
  copies per length), from 12045 to 76322 characters, 288 M characters (577 MB) for one message.
  `JSON.stringify` of `ui_messages.json` entry 108 (75345 characters) is exactly 76322
  characters, so the copies are `JSON.stringify(text)` of that block at every stage of its stream.
- Each copy is held by a `FixedArray` of length 2, the elements store of a JS array
  `[label, value]`. The labels are `"+\u00a0\u00a0\u00a0content"` and
  `"\u2013\u00a0\u00a0\u00a0content"`.

**Where that shape comes from.** `react-reconciler` 0.33 (React 19.2+), development build,
`addObjectDiffToProperties`: on every commit, for every component whose props changed, it builds
a diff of the props (`"+\u00a0"` new, `"\u2013\u00a0"` old, two NBSP per nesting level) whose string
values are `JSON.stringify(value)`, and passes it to
`performance.measure("\u200b" + name, { detail: { devtools: { properties } } })` for the DevTools
performance track. The development build has 17 `performance.measure` calls, the production build
none. Each package chooses its build once, at first load, from `process.env.NODE_ENV`, and the CLI
never set it. Node keeps every measure (with a structured clone of `detail`) until
`performance.clearMeasures()`: 200 measures of 50K two-byte characters held 19.6 MB, released by
`clearMeasures()`. The CLI's quiet mode replaces `process.emitWarning`, so nothing surfaced.

**Ruled out on the way:** `OutputManager` and the TUI store keep one copy per message (last
version only); `StateStore` history is off (`maxHistorySize` 0); the vscode-shim delivers
`postMessage` synchronously, without a queue; the cloud bridge's socket.io packets are one flat
`JSON.stringify` of the whole packet (checked with `%DebugPrint` on Node 22: one
`SEQ_TWO_BYTE_STRING`), not bare string literals; `ui_messages.json` is not saved per chunk.

**Counterfactual on the installed build** (`~/.roo/cli/bin/tumble`, the binary that crashed): a
fake OpenAI server streams 60K characters of two-byte reasoning in 8-character chunks (about 30 s)
and then calls `attempt_completion`; a `--require` probe samples, after a forced GC, the retained
measures and the heap. Only `NODE_ENV` differs.

| Run                                    | Retained measures | Characters in their details   | Heap at exit   |
| -------------------------------------- | ----------------- | ----------------------------- | -------------- |
| `NODE_ENV` unset (as the user runs it) | 5607              | 36.8 M, growing quadratically | 245.8 MB       |
| `NODE_ENV=production`                  | 0                 | 0                             | 163.5 MB, flat |

About 170 measures per second are recorded even without long text (every re-render of every
component with changed props), so a 26-minute session holds hundreds of thousands. The first crash
has the same signature (same build, long reasoning stream); its dump was not kept.

## Change

- `apps/cli/src/lib/utils/react-production.ts`: `loadReactProductionBuilds()` sets
  `NODE_ENV=production` only while it requires `react`, `react/jsx-runtime`, and, resolved from
  ink's location (pnpm does not hoist them), `react-reconciler` (which loads `scheduler`) and
  `react-reconciler/constants.js`; then restores the inherited value (deleting it if it was
  unset). Later ESM imports of these CommonJS packages get the cached production modules.
- `apps/cli/src/index.ts` is now a bootstrap: it calls the helper, then `await import("./main.js")`.
  A static import would be evaluated before the call; in the tsup output the CLI is now a separate
  chunk (`dist/index.js` is 788 bytes and imports only esbuild's runtime helpers).
- `apps/cli/src/main.ts` is the former `index.ts`, moved with `git mv`, unchanged.

**Why not the alternatives.**

- `NODE_ENV=production` for the whole process: the agent's commands inherit this environment, and
  `npm install` with `NODE_ENV=production` skips devDependencies.
- Honouring an explicit `NODE_ENV=development` from the shell: many web developers export it
  globally, and the CLI would still run out of memory for them. The helper always loads the
  production builds and only restores the variable for everything else.
- Eager `import("ink")` under the override: 374 ms for every command, including `--version` and
  print mode, which never render ink.
- Bundling React into the CLI with a `define`: every package importing React (ink, zustand) would
  have to be bundled too to keep a single React; a larger change for the same result.
- Clearing measures on a timer: the development build would still diff and `JSON.stringify` the
  whole message several times per render.

## Verification

- New `react-production.test.ts` runs a real ink render in a child process (React picks its build
  once per process; vitest itself runs with `NODE_ENV=test`): 20 re-renders leave measures without
  the helper (the control), 0 with it and `NODE_ENV` unset afterwards, and 0 with the shell's
  `NODE_ENV=development`, which is restored.
- Full CLI suite 974 passed, 1 skipped (the opt-in OpenRouter integration test); `tsc --noEmit`,
  `eslint` on the touched files, and `pnpm knip` all exit 0.
- The built `dist/index.js` in the same TUI run as the table above, `NODE_ENV` unset: 0 measures,
  heap flat at 163 to 164 MB, `NODE_ENV` still unset in the process; with `NODE_ENV=development` in
  the shell: 0 measures, still `development`. Both completed normally (exit 0).

## Notes

- The installed `~/.roo/cli` is not refreshed; it keeps crashing on long sessions until rebuilt.
- Unrelated observation from the probe runs: in 1 of 4 runs (installed build, `NODE_ENV=production`)
  the final screen showed the prompt ("think hard") as an assistant bullet; the other three,
  including both runs of the fixed build, showed `● …`. Looks like a timing race in the prompt
  echo skip, not caused by the React build. Not investigated.
- Probe kit (not committed): `/tmp/oom-probe` (`fake_reasoning.py`, `probe.cjs`, `run.sh`); dump
  analysis scripts in `/tmp/oom-crash` (`v8core.py` reads V8 objects in a core without pointer
  compression: string header is map, hash, length, then the characters).
