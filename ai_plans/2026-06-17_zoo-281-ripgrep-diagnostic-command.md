# Port plan — Zoo PR #281 → `feature/zoo-281-ripgrep-diagnostic-command`

## §0 Context & credit

- **Upstream:** Zoo-Code PR #281 `feat(ripgrep): add Show Ripgrep Diagnostic
command` (squashed commit `d29520b5c`).
- **Authors (credit on commit):**
    - `Co-authored-by: 0xMink <260166390+0xMink@users.noreply.github.com>`
    - `Co-authored-by: edelauna <54631123+edelauna@users.noreply.github.com>`
    - `Co-authored-by: Elliott de Launay <edelauna@gmail.com>`
- **Canonical source diff:** `git -C ../Zoo-Code show d29520b5c` (28 files).

## §1 What it does

Adds a user-triggerable VS Code command (`showRipgrepDiagnostic`) that runs the
same hybrid ripgrep-resolution logic our search path uses and writes a verbose
report to a dedicated output channel + the clipboard. The report covers three
steps:

1. `require("@vscode/ripgrep")` via a testable `loadRipgrep()` wrapper (surfaces
   the `.asar → .asar.unpacked` rewrite and whether the file exists).
2. A path probe of every known `appRoot`-relative candidate path, marking each
   `✓`/`✗`.
3. A `rg --version` spawn (5 s timeout) on the path `getBinPath()` selects —
   directly catching the "file exists but spawn fails" failure mode.

Motivated by the #248 ripgrep-universal layout bug (already ported to our fork):
debugging it required a custom instrumented VSIX. With this command shipped,
users hitting ripgrep-resolution weirdness can paste the diagnostic into a bug
report instead.

The PR refactors `getBinPath` to share its candidate list with the diagnostic via
a new exported `ripgrepCandidatePaths(appRoot)` helper, and reintroduces the
`@vscode/ripgrep` esbuild `external` entry (so the `require()` resolves at runtime
against VS Code's own `node_modules` rather than being bundled).

## §2 Fork adaptations (the judgment calls)

This PR is Zoo-branded; our fork is **Tumble Code**. Decisions made:

1. **Command id — routed through `getCommand()`, never hardcoded.** Upstream
   registers `zoo-code.showRipgrepDiagnostic`. Our `getCommand(id)` in
   `src/utils/commands.ts` produces `` `${Package.name}.${id}` `` →
   `tumble-code.showRipgrepDiagnostic`. `diagnostic.ts` calls
   `getCommand("showRipgrepDiagnostic")`. `"showRipgrepDiagnostic"` added to the
   `CommandId` union in `packages/types/src/vscode.ts` (matching the existing
   blank-line-separated style, appended after `toggleAutoApprove`).

2. **`package.json` command contribution** uses literal command id
   `tumble-code.showRipgrepDiagnostic` (matching siblings like
   `tumble-code.plusButtonClicked`) with `"title":
"%command.showRipgrepDiagnostic.title%"` and `"category":
"%configuration.title%"`, inserted between the `acceptInput` and
   `toggleAutoApprove` entries (mirroring the NLS insert position).

3. **NLS title VALUE — brand-neutral.** Inspected our existing command titles in
   `src/package.nls.json`: they are brand-neutral ("New Task", "Fix Code", "Accept
   Input/Suggestion"), NOT prefixed with "Tumble Code:". So the English value is
   **"Show Ripgrep Diagnostic"** (no brand prefix), matching upstream's English
   value exactly (upstream's en value also had no brand prefix; only the
   diagnostic report text and toast carry the brand). For the 17 non-English
   locales I mirrored upstream's per-locale localized string verbatim — none of
   upstream's title values contained "Zoo"/"Roo", so no brand-token swap was
   needed in any locale title. Inserted between `command.acceptInput.title` and
   `command.toggleAutoApprove.title` in every file.

4. **Brand tokens INSIDE `diagnostic.ts` (user-facing report/channel/toast)**
   swapped Zoo→Tumble:

    - OutputChannel name: `"Zoo Code Ripgrep Diagnostic"` → `"Tumble Code Ripgrep
Diagnostic"`.
    - Report header line: `"Zoo Code Ripgrep Diagnostic (…)"` → `"Tumble Code
Ripgrep Diagnostic (…)"`.
    - Toast: `"Zoo Code: ripgrep diagnostic copied to clipboard."` → `"Tumble
   Code: ripgrep diagnostic copied to clipboard."`.
      The test expectations were adapted to the Tumble strings accordingly.

5. **`@vscode/ripgrep` dependency — NOT re-added to `package.json`.** Verified it
   is absent from BOTH our `src/package.json` AND upstream's post-#281
   `src/package.json` (`@vscode/ripgrep` is a VS Code internal package resolved at
   runtime, not an npm devDep in either tree). Only the two things genuinely
   needed for the `require()` to compile+resolve were added:

    - `src/esbuild.mjs`: `"@vscode/ripgrep"` appended to the `external` array.
    - `knip.json`: `"@vscode/ripgrep"` added to `ignore` so knip doesn't flag the
      unlisted dependency.
      (Upstream's commit message says "reintroduces the devDep", but the actual diff
      never touched `package.json` deps — only `knip.json` + `esbuild.mjs`. We match
      the real diff, not the prose.)

6. **`registerCommands.ts` adaptation.** Our fork's pre-state used
   `Record<CommandId, any>` and had no separate diagnostic registration. Applied
   upstream's intent: added the import, the
   `context.subscriptions.push(registerRipgrepDiagnosticCommand())` call, the
   `CommandCallback` alias, and changed the map type to
   `Record<Exclude<CommandId, "showRipgrepDiagnostic">, CommandCallback>` so the
   diagnostic's separate registration owns the OutputChannel lifecycle.

## §3 How our `index.ts` differed from upstream pre-state

Our fork already ported #248 (the `@vscode/ripgrep-universal` layout). So our
pre-#281 `getBinPath` was a 6-branch `checkPath(...)||...` chain that ALREADY
included the two `ripgrep-universal` candidates — upstream's pre-#281 had only the
4 classic candidates plus its own universal addition. Both converge on the same
6-candidate ordered list. The #281 refactor (extract `ripgrepCandidatePaths()`,
loop in `getBinPath`) applied cleanly on top of our 6-candidate version: the
extracted helper lists exactly our 6 candidates in the same order, and `getBinPath`
became a `for` loop returning the first existing path. No behavioral change to
resolution order.

Confirmed `src/services/ripgrep/diagnostic.ts` and
`src/services/ripgrep/internal/loadRipgrep.ts` did NOT pre-exist (new files).

## §4 Out of scope — do NOT do these

- No TTS / router / cloud / Roo/Zoo branding reintroduced.
- No `package.json` dependency addition (§2.5).
- Internal ids stay (`@roo-code/types`, `Package.name` resolves to `tumble-code`).

## §5 Files changed (execution checklist)

### Types

- `packages/types/src/vscode.ts`: add `"showRipgrepDiagnostic"` to `commandIds`.

### New ripgrep modules

- `src/services/ripgrep/internal/loadRipgrep.ts` (NEW): `loadRipgrep()` require
  wrapper + `LoadRipgrepResult` type.
- `src/services/ripgrep/diagnostic.ts` (NEW): `trySpawnRipgrep`,
  `getRipgrepDiagnostic` (data fn), `registerRipgrepDiagnosticCommand` (cmd
  wrapper) — Tumble-branded strings.
- `src/services/ripgrep/index.ts`: extract `ripgrepCandidatePaths()` (exported),
  rewrite `getBinPath` as a loop over it.

### Wiring

- `src/activate/registerCommands.ts`: import + register the diagnostic command;
  exclude `showRipgrepDiagnostic` from `getCommandsMap`; `CommandCallback` alias.
- `src/package.json`: `contributes.commands` entry for
  `tumble-code.showRipgrepDiagnostic`.
- `src/package.nls.json` + 17 locale files: `command.showRipgrepDiagnostic.title`.
- `src/esbuild.mjs`: `@vscode/ripgrep` external.
- `knip.json`: `@vscode/ripgrep` ignore.

### Tests

- `src/services/ripgrep/__tests__/diagnostic.spec.ts` (NEW): 21 data-fn +
  registration tests, expectations adapted to `tumble-code.showRipgrepDiagnostic`
  and the Tumble channel/toast strings.
- `src/activate/__tests__/registerCommands.spec.ts`: mock the diagnostic module,
  add `commands.registerCommand` to the vscode mock, add a `registerCommands`
  describe verifying the disposable lands in `context.subscriptions`.

## §6 Verification (binary acceptance)

- `cd src && npx vitest run services/ripgrep/__tests__/diagnostic.spec.ts
activate/__tests__/registerCommands.spec.ts` → 25/25 GREEN.
- `pnpm --filter @roo-code/types check-types` → clean.
- `cd src && pnpm check-types` (`tsc --noEmit`) → clean.
- No new "Zoo"/"Roo" user-facing strings introduced.

## §7 Record in ledger

```bash
node .claude/skills/zoo-port/scripts/zoo-prs.mjs record \
  --pr 281 --status ported \
  --branch feature/zoo-281-ripgrep-diagnostic-command \
  --plan ai_plans/2026-06-17_zoo-281-ripgrep-diagnostic-command.md
```

Commit (only if asked) with the three `Co-authored-by:` trailers from §0.
