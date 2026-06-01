# Zoo PR #95 — Keep settings regression coverage in webview-ui tests

**Upstream:** Zoo-Code PR #95, squash-merged 2026-05-13 23:54 (`350e1720c`), authors Roomote, Elliott de Launay
**Branch:** `feature/zoo-95-settings-regression-tests` (off `main`)
**Type:** Test — unskip + fix two webview-ui settings regression specs; plus AGENTS.md test-placement docs.

## What the upstream PR does

1. **`ApiOptions.spec.tsx`** — un-skips `it("updates reasoningEffort in openAiCustomModelInfo
when select value changes")`. To make it real: imports `within`, extends the `ThinkingBudget`
   mock to render a `reasoning-effort` `<select>` when `modelInfo.supportsReasoningEffort`, and
   replaces the old `console.log` + `querySelector` with a proper
   `within(container).getByRole("combobox")` + `toHaveValue("low")` assertion and
   `fireEvent.change`.
2. **`SettingsView.unsaved-changes.spec.tsx`** — un-skips 5 previously-`it.skip`'d tests (the
   "automatic initialization must not look like a user edit" regressions) and fixes the
   `AlertDialog` mock to honor the `open` prop (`open ? <div data-testid="alert-dialog">…</div>
: null`) so the dialog-presence assertions are meaningful.
3. **AGENTS.md docs** (`AGENTS.md`, `webview-ui/AGENTS.md`, `apps/vscode-e2e/AGENTS.md`) — adds
   test-pyramid / test-placement guidance for agents.

## Scope in our fork (verified by content hash vs pre-image `350e1720c^1`)

| File                                    | State    | Action                                                                                                                                                                                         |
| --------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApiOptions.spec.tsx`                   | DIVERGED | **PORT** — `git apply` the upstream hunks (applied cleanly: import `within`, mock branch, unskip, assertion fix)                                                                               |
| `SettingsView.unsaved-changes.spec.tsx` | DIVERGED | **PORT** — `git apply` the upstream hunks (AlertDialog `open` mock + 5 unskips; applied cleanly)                                                                                               |
| `AGENTS.md` (root)                      | == PRE   | **PORT** — clean-apply the "Test Placement Guidance" section                                                                                                                                   |
| `webview-ui/AGENTS.md`                  | net-new  | **PORT** — copy post-image (self-contained webview-ui test-placement guidance; references the SettingsView cached-state pattern we already follow)                                             |
| `apps/vscode-e2e/AGENTS.md`             | net-new  | **SKIP** — that file documents the `@copilotkit/aimock` e2e infra our fork does not carry; the upstream change is a +2 hunk on a base we don't have (consistent with the zoo #50 / #72 calls). |

Both spec files were DIVERGED (our fork's own edits elsewhere in the files), but the upstream
patch hunks applied cleanly with `git apply` — the touched regions matched our pre-image. No
manual conflict resolution needed.

Tumble naming: none — test/doc only, internal ids unchanged.

## Verification (TDD — tests must pass, not just compile)

- `vitest run ApiOptions.spec.tsx` → **17 passed** (incl. the unskipped reasoningEffort test).
- `vitest run SettingsView.unsaved-changes.spec.tsx` → **6 passed** (all 5 previously-skipped
  regression tests now run green against our components — confirming our `SettingsView` already
  has the fix that makes these regressions valid).
- Build gate: `pnpm install:vsix -y --editor=code` — green before push.

## Credit

Co-authored-by: Roomote <roomote@roocode.com>
Co-authored-by: Elliott de Launay <edelauna@gmail.com>
