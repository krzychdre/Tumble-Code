# Zoo PR #239 — report PowerShell on Windows when no terminal profile is configured

- **Upstream:** Zoo-Code #239 (refs #82), commit `59b035f20`, merged 2026-05-27 (commit 13:21:31Z — second-oldest of the 05-27 candidate group by `%cI`, after the now-ported #213), author Armando Vaquera.
- **Branch:** `feature/zoo-239-shell-powershell-default` (off `main`).
- **Credit:** `Co-authored-by: Armando Vaquera <263793884+proyectoauraorg@users.noreply.github.com>`

## Problem

`getShell()` → `getWindowsShellFromVSCode()` returned `null` when VS Code had no
explicit Windows terminal `defaultProfileName`, so detection fell through to
COMSPEC (cmd.exe). But modern VS Code's integrated terminal launches PowerShell
by default on Windows — so the system prompt advertised cmd.exe while the real
shell was PowerShell, mismatching prompt/rules. (Issue #82.)

## Fix (`src/utils/shell.ts`)

1. `import { existsSync } from "fs"`.
2. In `getWindowsShellFromVSCode()`, replace the `if (!defaultProfileName) return null`
   branch with: probe for PowerShell 7 and return `SHELL_PATHS.POWERSHELL_7` when
   `pwsh.exe` exists, else `SHELL_PATHS.POWERSHELL_LEGACY` (Windows PowerShell 5.1,
   always present). Mirrors VS Code's own default-shell auto-detection. Explicitly
   configured cmd/WSL/custom profiles are unaffected (later branches unchanged).

## Tests (`src/utils/__tests__/shell.spec.ts`)

- `vi.mock("fs", () => ({ existsSync: vi.fn(() => false) }))`; reset to `false` in the
  top-level `beforeEach`.
- Replace the three now-obsolete "no VS Code config" tests with four that match the new
  behavior: PS7 present → pwsh.exe; PS7 absent → legacy PowerShell 5.1; non-allowlisted
  configured profile path → cmd.exe; explicit Command Prompt profile → cmd.exe.

## Fork compatibility (verified)

Fork `shell.ts` (the `getWindowsShellFromVSCode` early-return) and `shell.spec.ts`
(imports, `beforeEach`, the Windows test block, `mockVsCodeConfig` helper) both match
the upstream parent verbatim; `SHELL_PATHS.POWERSHELL_7` / `POWERSHELL_LEGACY` already
exist. Edits applied identically — no Tumble rename needed (internal util).

## Scope / skip

No changeset (fork port workflow omits them). Product + tests only.

## Verification

- `npx vitest run utils/__tests__/shell.spec.ts` (from `src/`).
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
