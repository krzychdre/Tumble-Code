# Port plan — Zoo PR #277 → `feature/zoo-277-terminal-profile-override`

## §0 Context & credit

- **Upstream:** Zoo-Code PR #277 `feat(terminal): add VS Code integrated-terminal
shell override` (squashed commit `019d85752`).
- **Authors (credit on commit):**
    - `Co-authored-by: Armando Vaquera <263793884+proyectoauraorg@users.noreply.github.com>`
    - `Co-authored-by: Elliott de Launay <edelauna@gmail.com>`
    - (roomote[bot] / Roomote AI trailers dropped — humans remain.)
- **Canonical source diff:** `/tmp/zoo-277.patch` (4033 lines, `git -C ../Zoo-Code show 019d85752`).
  This plan references it hunk-by-hunk. Our fork's terminal internals match
  upstream's _pre-change_ state exactly, so the hunks apply conceptually; only
  the fork adaptations in §2 differ.

## §1 What it does

Adds a `terminalProfile` global setting: the user picks a VS Code terminal
**profile name**; when set, the inline (VS Code integrated) terminal resolves
that profile from `terminal.integrated.profiles.<platform>` into a
shellPath/shellArgs/env and launches that shell instead of the default. Fixes
garbled output on Windows when the default shell uses a non-UTF-8 code page
(pick e.g. Git Bash). Bundled robustness fixes squashed into the same PR:

- `ShellIntegrationError` gains a `commandSubmitted` flag → only retry via execa
  when the command was **not** submitted (no double-run); show a warning when it
  was submitted but output was lost.
- cmd.exe fast-path: cmd.exe can't emit OSC 633, so route it straight to execa
  (`getTerminalProviderForExecution`, `isActiveShellCmdExe`).
- `prepareCommandForShellIntegration`: wrap multiline scripts in one block so a
  leading assignment can't detach the tracked execution.
- `activeShellExecution` tracking + `reuseKey` so terminals created under
  different profiles aren't reused interchangeably; `closeIdleTerminals()` on
  profile change.
- The `no_shell_integration` event/callback payload changes from `string` to
  `{ message, commandSubmitted }` (`ShellIntegrationErrorDetails`).

> **NOTE — a piece was added then reverted in this PR** (commit list: _"Revert
> 'replace pWaitFor with event-based shell integration wait'"_). The final
> squashed diff therefore **keeps `pWaitFor`** in `Terminal.runCommand` (only
> adding the cmd.exe branch around it). Do not add event-based waiting.

## §2 Fork adaptations (the only judgment calls — do these exactly)

1. **Branding in NEW i18n strings.** Upstream writes "Zoo Code". Our public brand
   is **"Tumble Code"** / **"Tumble"**. Every new `settings:terminal.profile.*`
   string uses Tumble Code (see §4 for the en text). For the 17 non-en locales,
   replicate upstream's localized block but **replace "Zoo Code" → "Tumble Code"**
   in each. (en/es/etc. — keep the localized prose, only swap the brand token.)
2. **Terminal name stays `"Roo Code"`.** Our `Terminal.ts:20` uses
   `name: "Roo Code"`. Upstream's new block hard-codes `"Zoo Code"`. Keep our
   existing `"Roo Code"` — do NOT introduce "Zoo Code" and do NOT rebrand to
   Tumble here (out of scope; minimal diff).
3. **ClineProvider TTS removed.** Upstream's 3 hunks (`ClineProvider.ts` patch
   lines 718-761) have `ttsEnabled`/`ttsSpeed`/`setTtsEnabled` context lines that
   **do not exist in our fork**. Apply the _intent_ only: insert `terminalProfile`
   immediately after each existing `terminalZdotdir` line:
    - the `updateSettings` destructure + bridge (our `ClineProvider.ts` ~857-866):
      add `terminalProfile,` to the destructure and `Terminal.setTerminalProfile(terminalProfile)`
      after `Terminal.setTerminalZdotdir(terminalZdotdir)`.
    - the state destructure (~2186): add `terminalProfile,`.
    - the returned state object (~2328): add `terminalProfile,` after
      `terminalZdotdir: terminalZdotdir ?? false,` (no `?? false` — string|undefined).
    - the second state builder (~2559): add `terminalProfile: stateValues.terminalProfile,`.
4. **Skip the aimock-gated e2e slice** (memory: aimock e2e family not ported).
   Do NOT create: `apps/vscode-e2e/fixtures/terminal-profile.json`,
   `apps/vscode-e2e/src/fixtures/terminal-profile.ts`,
   `apps/vscode-e2e/src/runTest.ts` (+2), or
   `apps/vscode-e2e/src/suite/tools/terminal-profile.test.ts`. These ride the
   `@copilotkit/aimock` fixture harness our fork rejected. Port only product + unit-test slices.
5. **`terminalCommandDelay ?? 50` → `?? 0`** (patch line 3418): upstream changed the
   displayed default. Leave our fork's current value **as-is** (do not touch) — it's
   an unrelated display tweak, out of the profile feature's scope.

## §3 Scope cuts / landmines (YAGNI)

- No TTS / router / cloud / Roo-branding re-introduction.
- Keep `pWaitFor` (the event-based rewrite was reverted upstream — §1 note).
- Don't touch `apps/vscode-e2e/*` (§2.4).
- `TerminalSettings.tsx`: our fork already imports `Select`, `SelectContent`,
  `SelectItem`, `SelectTrigger`, `SelectValue` and `SearchableSetting` — reuse
  them (DRY), do not re-import.

## §4 Files to change (execution checklist)

For each, the upstream hunk in `/tmp/zoo-277.patch` is the template; apply with §2
adaptations. Production + unit tests only.

### Types (`packages/types/`)

- `src/global-settings.ts` (patch 466-477): add `terminalProfile: z.string().optional(),`
  after `terminalZdotdir`.
- `src/vscode-extension-host.ts` (patch 478-515): add `"terminalProfiles"` to the
  ExtensionMessage `type` union; add `profiles?: string[]` field; add
  `"terminalProfile"` to the `ExtensionState` Pick union; add
  `"requestTerminalProfiles"` and `"openTerminalProfilePicker"` to the
  WebviewMessage `type` union.
- `src/api.ts` (patch 448-465): add `setTerminalProfile(name: string | undefined): void`
  to `RooCodeAPI`.

### Terminal engine (`src/integrations/terminal/`)

- `types.ts` (patch 3118-3161): add `reuseKey: string` to `RooTerminal`; change
  `onNoShellIntegration` + `no_shell_integration` event payload to
  `ShellIntegrationErrorDetails`; add `ShellIntegrationErrorDetails` interface and
  `ShellIntegrationError` class (with `commandSubmitted`).
- `BaseTerminal.ts` (patch 1115-1182): add `reuseKey` readonly field + constructor
  param `reuseKey: string = provider`; add static `terminalProfile` + `setTerminalProfile`
  (trim/normalize) + `getTerminalProfile`; update `setActiveStream` doc comment.
- `Terminal.ts` (patch 1183-1675): add `import { existsSync } from "fs"` and
  `import * as path from "path"`; add `activeShellExecution?` field; rewrite the
  constructor to build `vscode.TerminalOptions` (KEEP `name: "Roo Code"` per §2.2),
  resolve `getProfileShell()` → shellPath/shellArgs/env, guard ZDOTDIR cleanup with
  `&& !Terminal.getTerminalProfile()`; pass `Terminal.getReuseKey()` to `super(...)`;
  in `runCommand`, add the `isActiveShellCmdExe()` branch that emits
  `no_shell_integration { commandSubmitted:false }` and KEEP the existing `pWaitFor`
  branch (now emitting the object payload); change the `no_shell_integration` relay
  to pass `details`; guard `getEnv` ZDOTDIR with `&& !Terminal.getTerminalProfile()`;
  add the static helpers: `getPlatformProfileKey`, `resolveProfilePath`,
  `getConfiguredProfiles`, `getConfiguredDefaultProfileName`, `isCmdExe`,
  `isPowerShell`, `isFish`, `isActiveShellCmdExe`, `isActiveShellPowerShell`,
  `isActiveShellFish`, `getAvailableProfileNames`, `getReuseKey`, `getProfileShell`.
- `TerminalProcess.ts` (patch 1676-1883): remove `import { inspect } from "util"`;
  change the two `no_shell_integration` emits to object payloads (`commandSubmitted:true`);
  replace the `defaultWindowsShellProfile`/`isPowerShell` block with
  `Terminal.isActiveShellPowerShell()` + `isActiveShellFish()` shellKind; wrap the
  `executeCommand` call in try/catch, set `this.terminal.activeShellExecution` and
  `setActiveStream(execution.read())`; remove the `preOutput`/`commandOutputStarted`
  gating in the stream loop (read immediately, see hunk); clear `activeShellExecution`
  after `shellExecutionComplete`; add private `prepareCommandForShellIntegration`.
- `TerminalRegistry.ts` (patch 1884-1970): in `onDidStartTerminalShellExecution`
  move `e.execution.read()` inside the `terminal instanceof Terminal` branch and
  skip when `terminal.activeShellExecution === e.execution`; in the end handler
  clear `activeShellExecution`; in `getOrCreateTerminal` compute
  `reuseKey = provider === "vscode" ? Terminal.getReuseKey() : provider` and add
  `|| t.reuseKey !== reuseKey` to both find predicates; add static
  `closeIdleTerminals()`.

### Tool layer (`src/core/tools/`)

- `ExecuteCommandTool.ts` (patch 516-677): remove the local
  `class ShellIntegrationError extends Error {}`; re-export it from terminal/types;
  add `canRetryShellIntegrationError` and `getTerminalProviderForExecution`; update
  the catch block to use `canRetryShellIntegrationError` (silent execa retry when
  not submitted; warning + message when submitted); add the cmd.exe fallback status
  post; change `shellIntegrationError` to hold a `ShellIntegrationError`; update
  `onNoShellIntegration` to take `ShellIntegrationErrorDetails`; extract
  `formatExitStatus` and use it (the helper is referenced — define it in this file;
  see hunk 640-677 for the inline-format logic it replaces).

### Webview host wiring (`src/`)

- `core/webview/ClineProvider.ts` — §2.3 (TTS-adapted inserts).
- `core/webview/webviewMessageHandler.ts` (patch 949-1019): import `TerminalRegistry`;
  add the `terminalProfile` branch in the `updateSettings` key handler (normalize via
  Terminal, `closeIdleTerminals()` only when changed); add `openTerminalProfilePicker`
  case (`workbench.action.terminal.selectDefaultShell`); add `requestTerminalProfiles`
  case (post `Terminal.getAvailableProfileNames()`, empty array on throw).
- `extension.ts` (patch 1020-1038): import `Terminal`; call
  `Terminal.setTerminalProfile(undefined)` in `deactivate()` before
  `TerminalRegistry.cleanup()`.
- `extension/api.ts` (patch 1086-1114): import `Terminal` + `TerminalRegistry`; add
  `setTerminalProfile(name)` (close idle terminals only when normalized profile changed).

### Webview UI (`webview-ui/src/`)

- `context/ExtensionStateContext.tsx` (patch 3672-3691): add `terminalProfile?: string`
  to the context type and `terminalProfile: undefined` to the default state.
- `components/settings/SettingsView.tsx` (patch 3162-3190): destructure
  `terminalProfile`; add `terminalProfile: terminalProfile ?? ""` to the saved payload;
  pass `terminalProfile` + `onTerminalProfilePickerOpened={() => setChangeDetected(true)}`
  to `<TerminalSettings>`.
- `components/settings/TerminalSettings.tsx` (patch 3191-3422): add `useEffect, useId`
  to the react import and `VSCodeButton` to the toolkit import; add the two new props;
  add `DEFAULT_PROFILE_VALUE` sentinel; add the `profileNames`/`isProfilesLoaded` state,
  `requestTerminalProfiles` on mount, `terminalProfiles` message handling, the
  stale-profile-clearing `useEffect`, and the radio/Select profile-override UI block
  (gated on `isVSCodeTerminalEnabled`). **Do NOT** apply the `?? 50 → ?? 0` tweak (§2.5).
- `i18n/locales/en/settings.json` (patch 3730-3748): add the `profile` block under
  `terminal` with **Tumble Code** branding:
    ```json
    "profile": {
        "label": "Tumble Code terminal override",
        "default": "Use VS Code default profile (recommended)",
        "overrideLabel": "Override shell for Tumble Code",
        "configureButton": "Choose default profile in VS Code",
        "noProfiles": "(no path-based profiles found in terminal.integrated.profiles)",
        "description": "By default Tumble Code uses whatever shell VS Code is configured to use. Select Override to pick a path-based shell profile exposed by VS Code. Source-only profiles (e.g. the built-in PowerShell entry) cannot be listed here. <0>Learn more</0>"
    }
    ```
- The other 17 locale `settings.json` (patch 3692-4033, except en): add the same
  `profile` block, copying upstream's localized strings but swapping **"Zoo Code" →
  "Tumble Code"** in each. Our fork ships the same locale set; confirm each file has a
  `terminal.inheritEnv` block to anchor the insert.

## §5 TDD — failing tests first

Port the upstream unit tests (they encode the contract); confirm RED before the
production edits land, GREEN after. Add/extend:

1. `src/integrations/terminal/__tests__/TerminalProfile.spec.ts` (NEW, patch
   2220-2919, 694 lines): the core profile-resolution suite (`getProfileShell`,
   `resolveProfilePath`, `getAvailableProfileNames`, `isActiveShell*`,
   `getConfiguredProfiles` trusted-scope guard, env sanitization/blocked keys).
2. `src/core/tools/__tests__/executeCommandTool.spec.ts` (patch 678-717): the 3
   new cases (`canRetryShellIntegrationError` true/false, `getTerminalProviderForExecution`
   cmd.exe → execa).
3. `src/core/webview/__tests__/webviewMessageHandler.spec.ts` (patch 795-948): the
   `terminalProfile` / `requestTerminalProfiles` / `openTerminalProfilePicker` suites.
4. `src/core/webview/__tests__/ClineProvider.spec.ts` (patch 762-794): the
   `resolveWebviewView` hydration test.
5. `src/extension/__tests__/api-terminal-profile.spec.ts` (NEW, patch 1039-1085).
6. `src/integrations/terminal/__tests__/TerminalProcess.spec.ts` (patch 1971-2174)
    - `TerminalRegistry.spec.ts` (patch 2920-3073) + the 3 `TerminalProcessExec.*`
      stream-util touch-ups (patch 2175-3117).
7. `webview-ui/src/components/settings/__tests__/TerminalSettings.profile.spec.tsx`
   (NEW, patch 3435-3671) + the `SettingsView.change-detection.spec.tsx` +1 (patch 3423-3434).

Commands (run RED first, then GREEN):

- backend: `cd src && npx vitest run integrations/terminal core/tools/__tests__/executeCommandTool.spec.ts core/webview/__tests__/webviewMessageHandler.spec.ts core/webview/__tests__/ClineProvider.spec.ts extension/__tests__/api-terminal-profile.spec.ts`
- webview: `cd webview-ui && npx vitest run src/components/settings/__tests__/TerminalSettings.profile.spec.tsx src/components/settings/__tests__/SettingsView.change-detection.spec.tsx`

## §6 Verification (binary acceptance)

- Backend vitest suites above → GREEN (no new failures vs baseline).
- Webview vitest suites above → GREEN.
- root `pnpm check-types` → 13/13.
- `cd src && pnpm lint` → exit 0; `cd webview-ui && pnpm lint` → exit 0.
- `pnpm --filter @roo-code/types check-types` clean (schema change compiles).
- No reference to "Zoo Code" introduced anywhere (`grep -rn "Zoo Code" src webview-ui packages` → only pre-existing, none new).
