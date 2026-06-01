# Zoo PR #72 — test(e2e): add DeepSeek V4 coverage

**Upstream:** Zoo-Code PR #72, squash-merged 2026-05-13 (`667795aa8`), authors Elliott de Launay, Roomote
**Branch:** `feature/zoo-72-deepseek-v4-e2e` — **stacked on `feature/zoo-6-deepseek-v4`**
**Type:** Test (e2e) — net-new provider integration test, opt-in via `DEEPSEEK_API_KEY`.

## Why stacked (not off main)

The test exercises the `deepseek-v4-flash` / `deepseek-v4-pro` models. Those models do **not**
exist on `main` — they were added by **zoo #6 (DeepSeek V4 Support)**, which we ported to
`feature/zoo-6-deepseek-v4` (status=ported, not yet merged to main). Branching #72 off main
would reference nonexistent models. Per the dependency/overlap stacking rule, this branch is
stacked on `feature/zoo-6-deepseek-v4` so the V4 models are present and the test is coherent.

## What the upstream PR does

Adds a recorded-fixture / real-API e2e suite for DeepSeek V4 plus the aimock plumbing to
replay it in CI:

| File                                                      | Upstream                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `apps/vscode-e2e/src/suite/providers/deepseek-v4.test.ts` | +402 — the suite (tool-using probe ×4: flash/pro × reasoning on/off) |
| `apps/vscode-e2e/.env.local.sample`                       | +1 — `DEEPSEEK_API_KEY=sk-...`                                       |
| `apps/vscode-e2e/src/runTest.ts`                          | +34 — aimock record/replay gating for DeepSeek                       |
| `apps/vscode-e2e/AGENTS.md`                               | +55 — aimock fixture-authoring docs                                  |
| `apps/vscode-e2e/fixtures/deepseek-v4.json`               | +128 — aimock replay recording                                       |

The test wraps `globalThis.fetch` to capture the outgoing DeepSeek requests (model,
`thinking.type`, `reasoning_effort`, `max_completion_tokens`) and forwards to the **real**
endpoint. It drives a real task ("read the marker file, reply with the marker") and asserts
the model completes the tool-use loop and that reasoning on/off maps to the right request
shape. It **skips** when neither `AIMOCK_URL` nor `DEEPSEEK_API_KEY` is set.

## Scope in our fork (verified by content hash vs pre-image `667795aa8^1`)

| File                        | State    | Action                                                                                                                                                                                                      |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deepseek-v4.test.ts`       | net-new  | **PORT** — copy post-image; imports (`waitFor`,`waitUntilAborted`,`sleep`,`setDefaultSuiteTimeout`) all exist in our e2e utils; self-contained, no aimock import                                            |
| `.env.local.sample`         | == PRE   | **PORT** — append the `DEEPSEEK_API_KEY` line (clean apply)                                                                                                                                                 |
| `runTest.ts`                | DIVERGED | **SKIP** — the diff only re-gates the aimock record/replay flow (`LLMock`, `AIMOCK_RECORD`, mock provider URLs). Our fork's `runTest.ts` has **no aimock machinery at all**, so the change is inapplicable. |
| `AGENTS.md`                 | net-new  | **SKIP** — pure aimock fixture-authoring docs; our fork has no aimock (same call as zoo #50).                                                                                                               |
| `fixtures/deepseek-v4.json` | net-new  | **SKIP** — the aimock replay recording. The test never reads it directly; it is consumed only by the aimock mock server via `AIMOCK_URL`, which we never set. Dead weight without the aimock infra.         |

Why not port the aimock layer too: bringing the `@copilotkit/aimock` dependency + `LLMock`
record/replay into `runTest.ts` is a large, separate infra import our fork deliberately does
not carry (established in the zoo #50 port). #72's value for us is the **real-API,
opt-in** integration test, which stands alone.

Tumble naming: only internal ids (`deepseek`, model ids, `RooCodeEventName`) — all stay. No
brand strings.

## Plan

1. `mkdir apps/vscode-e2e/src/suite/providers/` and copy the post-image `deepseek-v4.test.ts`.
2. Append `DEEPSEEK_API_KEY=sk-...` to `apps/vscode-e2e/.env.local.sample` (matches post-image).
3. Skip `runTest.ts`, `AGENTS.md`, `fixtures/deepseek-v4.json`.

## Verification

- `tsc -p tsconfig.esm.json --noEmit` on `apps/vscode-e2e` — the new test compiles against
  our utils + the V4 models on the #6 branch.
- eslint the new file — clean.
- The suite auto-discovers via `glob("**/**.test.js")`; with no key set it `this.skip()`s,
  so CI stays green.
- Build gate: `pnpm install:vsix -y --editor=code` — green before push.

## Credit

Co-authored-by: Elliott de Launay <edelauna@gmail.com>
Co-authored-by: Roomote <roomote@roocode.com>
