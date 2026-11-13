# R4 A5 a-c: esbuild-wasm alignment, @types/jest removal, pnpm override audit

**Status:** done.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md` (items A5a, A5b, A5c).
**Touched files:** `package.json`, `src/package.json`, `webview-ui/package.json`, `webview-ui/vitest.setup.ts`,
`pnpm-lock.yaml`.

## Problem

- `src` declared `esbuild-wasm ^0.25` while the build uses `esbuild ^0.28`: two esbuild lines in one tree.
- `webview-ui` carried `@types/jest` although nothing runs jest; it type-checked only because of a redundant plain
  `import "@testing-library/jest-dom"` next to the `/vitest` entry in `vitest.setup.ts`.
- The root `pnpm.overrides` held floors added for old advisories and compatibility pins; some may no longer change
  anything.

## Change

- `esbuild-wasm` is `^0.28.2` in `src/package.json` and in the root overrides next to `esbuild` (resolves 0.28.2).
- `@types/jest` and the plain jest-dom import are gone; `@testing-library/jest-dom/vitest` registers the matchers
  and their types.
- Override audit. Procedure: in a scratch copy of the manifests and lockfile, remove one override, run
  `pnpm install --lockfile-only --ignore-scripts`, compare the lockfile. Removed, because only the `overrides:`
  header of the lockfile changed (and, for picomatch, the peer range text of one package; the resolved versions
  stayed the same): `form-data` (GHSA-fjxv-7rqg-78g4), `proxy-addr` (GHSA-jqcg-44mw-7w3h), `picomatch@>=4`
  (GHSA-c2c7-rcm5-vvqj, GHSA-3v7f-55p6-f55p).

Survivors (package.json has no comments, so the reason lives here):

| Override                     | Why                                                                | Without it                                |
| ---------------------------- | ------------------------------------------------------------------ | ----------------------------------------- |
| `tar-fs >=3.1.1`             | GHSA-vj76-c3g6-qr5v, GHSA-8cj5-5rvv-wf4v (#4629)                   | tar-fs 2.1.5 (patched) appears            |
| `undici ^7.29.0`             | one undici line for the host (DEP-6b, #320)                        | openai pulls undici 6 and 7               |
| `jsdom>undici ^8.10.2`       | jsdom 30 needs undici 8 against the root pin (#487)                | jsdom gets undici 7                       |
| `rehype-katex>katex ^0.18.9` | the renderer and the stylesheet use one KaTeX (#501)               | katex 0.16.47                             |
| `brace-expansion ^2.0.2`     | GHSA-v6h2-p8h4-qcjw family (#4844)                                 | 1.1.21, 2.1.7, 5.0.12 (all patched)       |
| `bluebird >=3.7.2`           | mammoth's old bluebird breaks on Node's global `navigator` (#6363) | bluebird 3.4.7                            |
| `glob ^13.0.6`               | GHSA-5j98-mcp5-4vw2 (#257)                                         | 7.2.3, 10.5.0, 11.1.0 (all patched)       |
| `lodash-es ^4.18.1`          | GHSA-r5fr-rjxr-66jc, GHSA-f23m-r3pf-42rh (#800)                    | lodash-es 4.17.23 (vulnerable)            |
| `@lmstudio/sdk>zod 3.25.76`  | the SDK needs zod 3 (#471)                                         | zod-to-json-schema resolves against zod 4 |

`esbuild`, `esbuild-wasm`, `zod` and `typescript` are single-version pins, not advisory floors, and were not audited.

## Tests

- `pnpm --filter @tumble-code/vscode-webview check-types` green; `pnpm why -r @types/jest` empty.
- `packages/core` custom-tools specs (75 tests, they transpile real files through esbuild-wasm) green.
- `webview-ui` `ChatTextArea.spec.tsx` (jest-dom matchers through the `/vitest` entry) green.

## Notes

`brace-expansion` and `glob` would resolve to patched versions without their overrides, but removing them changes
the resolved tree (the overrides force one major across consumers that ask for others). Dropping them is a
separate decision with its own test run.
