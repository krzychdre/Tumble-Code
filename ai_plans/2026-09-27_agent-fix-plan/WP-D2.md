# WP-D2: Literal setting defaults at call sites -> SETTINGS_DEFAULTS

Status: ready
Effort: S      Risk: low      Depends on: none
Branch name: fix/d2-settings-defaults-call-sites      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

Host code in `src/` still writes the default of a setting as a literal (`= true`, `?? "default"`, `|| 5`) instead
of reading it from the one table `SETTINGS_DEFAULTS` (`packages/types/src/settings-defaults.ts`). Replace every
such literal in `src/` with `SETTINGS_DEFAULTS.<key>`. `requestDelaySeconds` has no row in the table yet, so add
one (value 5, the value the code already uses) and make `getState()` carry it.

## 2. Why it matters (user-visible effect, 2-4 sentences)

One place per default: a future change of a default can no longer miss a call site. There is one real bug fixed on
the way: `getState()` never carries `requestDelaySeconds` (it is neither in `SETTINGS_DEFAULTS` nor in
`PASSTHROUGH_SETTING_KEYS` of `ProviderStateBuilder`), so the retry backoff always starts at 5 seconds even when a
user imported another value with "Import settings". After this WP an imported value is honoured.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `docs/architecture.md`, section "Where settings defaults live today".
- `packages/types/src/settings-defaults.ts`: `settingsDefaults`, `SETTINGS_DEFAULTS`, `resolveSettings`.
- `packages/types/src/__tests__/settings-defaults.spec.ts`: second `it` of `describe("SETTINGS_DEFAULTS")`.
- `src/core/webview/ProviderStateBuilder.ts`: `PASSTHROUGH_SETTING_KEYS`, `getState` (the `...pick(settings, SETTINGS_DEFAULT_KEYS)` line).
- `src/core/task/RetryHandler.ts`: `calculateBackoffDelay`.
- `src/core/task/TaskApiLoop.ts`: `attemptApiRequest` (near line 1298).
- `src/core/webview/ClineProvider.ts`: the `this.getState().then(({ terminalShellIntegrationTimeout = ...` block in `resolveWebviewView` (near line 878).
- `src/core/tools/ExecuteCommandTool.ts`: `execute` (near line 124) and `executeCommandInTerminal` (near line 220).
- `src/core/mentions/processUserContentMentions.ts`: `processUserContentMentions` parameters (near line 36).
- `src/core/task/TaskLifecycle.ts`: `initializeTaskApiConfigName` (near line 210).
- `src/extension/api.ts`: `setConfiguration` (near line 356).
- `src/core/task/TaskAskSay.ts`: `SUBAGENT_ASK_FALLBACK_TIMEOUT_MS` (near line 35) and its use (near line 405).
- `src/core/webview/__tests__/ClineProvider.stateBuilder.spec.ts` and its snapshot
  `src/core/webview/__tests__/__snapshots__/ClineProvider.stateBuilder.spec.ts.snap`.

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`src/core/task/RetryHandler.ts`, `calculateBackoffDelay` (near line 84):

```ts
	calculateBackoffDelay(retryAttempt: number, error: any, state: any): number {
		const baseDelay = state?.requestDelaySeconds || 5
```

`src/core/task/TaskApiLoop.ts`, `attemptApiRequest` (near line 1298):

```ts
		const state = await this.access.providerRef.deref()?.getState()

		const {
			apiConfiguration,
			autoApprovalEnabled,
			requestDelaySeconds,
			autoCondenseContext = true,
			autoCondenseContextPercent = 100,
			profileThresholds = {},
		} = state ?? {}
```

(`requestDelaySeconds` is destructured but never used in this method; verified with
`grep -n requestDelaySeconds src/core/task/TaskApiLoop.ts` -> only line 1303.)

`src/core/webview/ClineProvider.ts`, `resolveWebviewView` (near line 878):

```ts
		this.getState().then(
			({
				terminalShellIntegrationTimeout = Terminal.defaultShellIntegrationTimeout,
				terminalShellIntegrationDisabled = false,
				terminalCommandDelay = 0,
				terminalZshClearEolMark = true,
				terminalZshOhMy = false,
				terminalZshP10k = false,
				terminalPowershellCounter = false,
				terminalZdotdir = false,
				terminalProfile,
			}) => {
```

Note `terminalShellIntegrationDisabled = false` while the table says `true`.

`src/core/tools/ExecuteCommandTool.ts`, `execute` (near line 124):

```ts
			const { terminalShellIntegrationDisabled = true } = providerState ?? {}
```

`src/core/tools/ExecuteCommandTool.ts`, `executeCommandInTerminal` (near line 220):

```ts
export async function executeCommandInTerminal(
	task: Task,
	{
		executionId,
		command,
		customCwd,
		terminalShellIntegrationDisabled = true,
		commandExecutionTimeout = 0,
		agentTimeout = 0,
	}: ExecuteCommandOptions,
```

`src/core/mentions/processUserContentMentions.ts`, `processUserContentMentions` (near line 36):

```ts
export async function processUserContentMentions({
	userContent,
	cwd,
	fileContextTracker,
	rooIgnoreController,
	showRooIgnoredFiles = false,
	includeDiagnosticMessages = true,
	maxDiagnosticMessages = 50,
	skillsManager,
	currentMode = "code",
}: {
```

`src/core/task/TaskLifecycle.ts`, `initializeTaskApiConfigName` (near line 210):

```ts
			if (this.access._taskApiConfigName === undefined) {
				this.access._taskApiConfigName = state?.currentApiConfigName ?? "default"
			}
		} catch (error) {
			// If there's an error getting state, use the default profile (unless a newer value was set).
			if (this.access._taskApiConfigName === undefined) {
				this.access._taskApiConfigName = "default"
```

`src/extension/api.ts`, `setConfiguration` (near line 356):

```ts
		await this.sidebarProvider.providerSettingsManager.saveConfig(values.currentApiConfigName || "default", values)
```

`src/core/task/TaskAskSay.ts` (near line 29 and 405):

```ts
/**
 * How long a headless subagent's interactive ask (followup question) may wait
 * for a user answer before falling back to a plain approval. Keeps unattended
 * fan-outs bounded while giving a watching user a real window to reply.
 */
export const SUBAGENT_ASK_FALLBACK_TIMEOUT_MS = 5 * 60 * 1000
```

```ts
				(state?.subagentFollowupTimeoutSec ?? SUBAGENT_ASK_FALLBACK_TIMEOUT_MS / 1000) * 1000,
```

(`SUBAGENT_ASK_FALLBACK_TIMEOUT_MS` has no other user in the repo; `SETTINGS_DEFAULTS.subagentFollowupTimeoutSec`
is `DEFAULT_SUBAGENT_FOLLOWUP_TIMEOUT_SEC` = 300, the same value.)

## 5. Root cause / analysis

VERIFIED (read):

- `getState()` (`ProviderStateBuilder.getState`) returns `...pick(settings, SETTINGS_DEFAULT_KEYS)` and
  `...pick(settings, PASSTHROUGH_SETTING_KEYS)` after `resolveSettings`. So every key that IS in the table is never
  `undefined` in the real state; the literal fallbacks listed above only take effect when `state` is `undefined`
  (provider already disposed) or in tests that mock `getState`. Replacing them changes nothing in production except
  for the one mismatch in `ClineProvider` (`terminalShellIntegrationDisabled = false` vs table `true`), which in
  production is also never reached.
- `requestDelaySeconds` is in neither list, so `state.requestDelaySeconds` is always `undefined` in production and
  `RetryHandler` always uses 5. The schema has it (`packages/types/src/global-settings.ts` near line 168,
  `requestDelaySeconds: z.number().optional()`), `ExtensionState` picks it (`vscode-extension-host.ts` near
  line 375) and settings import accepts it (`importExport.spec.ts` validates it). No webview control edits it.
- `|| 5` vs `??`: with `||`, a stored `0` becomes 5. A zero base would retry with no backoff at all (`Math.ceil(0 * 2^n) = 0`,
  and `backoffAndAnnounce` returns immediately when the delay is `<= 0`). Keep that protection explicitly (see step 3)
  instead of switching blindly to `??`.
- The claim "TaskApiLoop hard-codes autoCondenseContext = true and autoCondenseContextPercent = 100": correct (as
  destructuring defaults). Both match the table values, so behaviour is unchanged.
- NOT a default, leave alone: `TaskContextManager.ts` near line 465 `autoCondenseContext: true,
  autoCondenseContextPercent: FORCED_CONTEXT_REDUCTION_PERCENT` (the forced reduction path, deliberate).
- Already fine (named constant from the same source, not a literal): `?? DEFAULT_WRITE_DELAY_MS` in
  `src/core/tools/helpers/applyComputedEdit.ts:89`, `src/core/tools/WriteToFileTool.ts:108`,
  `src/core/tools/ApplyDiffTool.ts:133`, and `?? DEFAULT_PARALLEL_TASKS_MAX_CONCURRENCY` in
  `src/core/tools/RunParallelTasksTool.ts:489`. Leave them.
- Container defaults left alone on purpose (the table's `[]`/`{}` are frozen; handing a frozen container to code
  that might mutate it is a risk for no gain): `TaskApiLoop.ts:1306 profileThresholds = {}`,
  `src/core/webview/messageHandlers/enhanceAndSearch.ts:23 listApiConfigMeta = []`,
  `src/core/webview/ClineProvider.ts:1245 this.contextProxy.getValues().listApiConfigMeta || []`.

Complete grep result of literal fallbacks on table keys in `src/` (non-test), all handled in section 6 unless listed
as "leave" above:

```
src/extension/api.ts:358                          currentApiConfigName || "default"
src/core/task/TaskLifecycle.ts:217                currentApiConfigName ?? "default"
src/core/task/TaskApiLoop.ts:1304-1305            autoCondenseContext = true / autoCondenseContextPercent = 100
src/core/task/RetryHandler.ts:85                  requestDelaySeconds || 5   (key not in table yet)
src/core/task/TaskAskSay.ts:405                   subagentFollowupTimeoutSec ?? SUBAGENT_ASK_FALLBACK_TIMEOUT_MS / 1000
src/core/mentions/processUserContentMentions.ts:41-43  showRooIgnoredFiles / includeDiagnosticMessages / maxDiagnosticMessages
src/core/tools/ExecuteCommandTool.ts:124,226      terminalShellIntegrationDisabled = true
src/core/webview/ClineProvider.ts:881-888         terminal* destructuring defaults
```

Out of scope (webview; a follow-up item, do NOT change here): the same pattern in
`webview-ui/src/components/settings/ContextManagementSettings.tsx` (lines 172, 176, 195, 199, 218, 222, 274, 305,
357, 370, 376, 383), `TerminalSettings.tsx` (291, 401, 409, 430, 458, 486, 510, 534), `NotificationSettings.tsx`
(194, 198), `WebToolsSettings.tsx` (35, 58), `SettingsView.tsx` (614, 695, 696), `AutoApproveSettings.tsx` (139),
`chat/AutoApproveDropdown.tsx` (129), `hooks/useAutoApprovalState.ts` (20), `context/ExtensionStateContext.tsx`
(156, 177, 184, 221), `context/extensionStateReducer.ts` (268), and `packages/types/src/web-tools.ts` (100, 101).
Report this real bug found there to the caller: `TerminalSettings.tsx:409` displays `{terminalCommandDelay ?? 50}ms`
while the slider on line 401 and the table use 0.

The grep used (reproduce it):

```sh
cd /home/user/Tumble-Code
keys=$(node -e 'const s=require("fs").readFileSync("packages/types/src/settings-defaults.ts","utf8");const m=s.split("const settingsDefaults = {")[1].split("} satisfies")[0];console.log([...m.matchAll(/^\s*(\w+):/gm)].map(x=>x[1]).join("|"))')
grep -rnE "\b($keys)\b\s*(\?\?|\|\|)\s*(true|false|-?[0-9]|\"|'|\[|\{)" src --include=*.ts | grep -v "__tests__\|\.spec\.\|\.test\."
grep -rnE "^\s*($keys)\s*=\s*(true|false|-?[0-9]|\"|'|\[|\{)" src --include=*.ts | grep -v "__tests__\|\.spec\.\|\.test\."
```

HYPOTHESIS: adding `requestDelaySeconds` to the table changes exactly two golden snapshots in
`ClineProvider.stateBuilder.spec.ts.snap` (a new `"requestDelaySeconds": 5` line in each `getState()` and
`getStateToPostToWebview()` entry, 3 fixtures x 2 = 6 places) and possibly
`webviewMessageHandler.routing.spec.ts.snap`. Confirm with step 9 of section 8: run the specs, read the diff; if
the only diffs are added `requestDelaySeconds` lines (value 5, or the fixture's stored value), update with `-u`. If
anything else changes, stop (section 12).

## 6. Step-by-step changes

1. `packages/types/src/settings-defaults.ts`. Find:

```ts
	autoCondenseContext: true,
	autoCondenseContextPercent: 100,
```

Replace with:

```ts
	autoCondenseContext: true,
	autoCondenseContextPercent: 100,

	// Base of the API retry backoff, in seconds (doubled per attempt).
	requestDelaySeconds: 5,
```

2. `packages/types/src/__tests__/settings-defaults.spec.ts`. Find:

```ts
		expect(SETTINGS_DEFAULTS.customSoundCelebration).toBeNull()
	})
```

Replace with:

```ts
		expect(SETTINGS_DEFAULTS.customSoundCelebration).toBeNull()
		expect(SETTINGS_DEFAULTS.requestDelaySeconds).toBe(5)
		expect(SETTINGS_DEFAULTS.autoCondenseContext).toBe(true)
		expect(SETTINGS_DEFAULTS.autoCondenseContextPercent).toBe(100)
	})
```

3. `src/core/task/RetryHandler.ts`. Find:

```ts
import { type ProviderSettings } from "@roo-code/types"
```

Replace with:

```ts
import { type ProviderSettings, SETTINGS_DEFAULTS } from "@roo-code/types"
```

Find:

```ts
		const baseDelay = state?.requestDelaySeconds || 5
```

Replace with:

```ts
		const configuredDelay: number = state?.requestDelaySeconds ?? SETTINGS_DEFAULTS.requestDelaySeconds
		// A zero (or negative) base would retry at once, without any backoff.
		const baseDelay = configuredDelay > 0 ? configuredDelay : SETTINGS_DEFAULTS.requestDelaySeconds
```

4. `src/core/task/TaskApiLoop.ts` (`SETTINGS_DEFAULTS` is already imported on line 19). Find:

```ts
		const {
			apiConfiguration,
			autoApprovalEnabled,
			requestDelaySeconds,
			autoCondenseContext = true,
			autoCondenseContextPercent = 100,
			profileThresholds = {},
		} = state ?? {}
```

Replace with:

```ts
		const {
			apiConfiguration,
			autoApprovalEnabled,
			autoCondenseContext = SETTINGS_DEFAULTS.autoCondenseContext,
			autoCondenseContextPercent = SETTINGS_DEFAULTS.autoCondenseContextPercent,
			profileThresholds = {},
		} = state ?? {}
```

Before this step run `grep -n "autoApprovalEnabled" src/core/task/TaskApiLoop.ts`; if `autoApprovalEnabled` is also
unused in `attemptApiRequest`, leave it anyway (not part of this WP).

5. `src/core/webview/ClineProvider.ts`. Add `SETTINGS_DEFAULTS,` to the existing `@roo-code/types` import. Find:

```ts
	isRetiredProvider,
	TelemetryEventName,
} from "@roo-code/types"
```

Replace with:

```ts
	isRetiredProvider,
	TelemetryEventName,
	SETTINGS_DEFAULTS,
} from "@roo-code/types"
```

Then find:

```ts
				terminalShellIntegrationTimeout = Terminal.defaultShellIntegrationTimeout,
				terminalShellIntegrationDisabled = false,
				terminalCommandDelay = 0,
				terminalZshClearEolMark = true,
				terminalZshOhMy = false,
				terminalZshP10k = false,
				terminalPowershellCounter = false,
				terminalZdotdir = false,
				terminalProfile,
```

Replace with:

```ts
				terminalShellIntegrationTimeout = SETTINGS_DEFAULTS.terminalShellIntegrationTimeout,
				terminalShellIntegrationDisabled = SETTINGS_DEFAULTS.terminalShellIntegrationDisabled,
				terminalCommandDelay = SETTINGS_DEFAULTS.terminalCommandDelay,
				terminalZshClearEolMark = SETTINGS_DEFAULTS.terminalZshClearEolMark,
				terminalZshOhMy = SETTINGS_DEFAULTS.terminalZshOhMy,
				terminalZshP10k = SETTINGS_DEFAULTS.terminalZshP10k,
				terminalPowershellCounter = SETTINGS_DEFAULTS.terminalPowershellCounter,
				terminalZdotdir = SETTINGS_DEFAULTS.terminalZdotdir,
				terminalProfile,
```

If `Terminal` becomes an unused import after this, it is not: it is still used for `Terminal.setShellIntegrationTimeout(...)`.
(`Terminal.defaultShellIntegrationTimeout` equals `DEFAULT_TERMINAL_SHELL_INTEGRATION_TIMEOUT_MS`, which is the
table value; verified in `src/integrations/terminal/BaseTerminal.ts:159`.) This block is in `resolveWebviewView`,
NOT in a `postStateToWebview*` method, so the do-not-touch rule does not apply.

6. `src/core/tools/ExecuteCommandTool.ts`. Find:

```ts
	readCliRuntimeEnv,
	TelemetryEventName,
} from "@roo-code/types"
```

Replace with:

```ts
	readCliRuntimeEnv,
	SETTINGS_DEFAULTS,
	TelemetryEventName,
} from "@roo-code/types"
```

Find:

```ts
			const { terminalShellIntegrationDisabled = true } = providerState ?? {}
```

Replace with:

```ts
			const { terminalShellIntegrationDisabled = SETTINGS_DEFAULTS.terminalShellIntegrationDisabled } =
				providerState ?? {}
```

Find:

```ts
		customCwd,
		terminalShellIntegrationDisabled = true,
		commandExecutionTimeout = 0,
```

Replace with:

```ts
		customCwd,
		terminalShellIntegrationDisabled = SETTINGS_DEFAULTS.terminalShellIntegrationDisabled,
		commandExecutionTimeout = 0,
```

(`commandExecutionTimeout` and `agentTimeout` are not table keys; leave them.)

7. `src/core/mentions/processUserContentMentions.ts`. Find:

```ts
import Anthropic from "@anthropic-ai/sdk"

import { parseMentions, ParseMentionsResult, MentionContentBlock } from "./index"
```

Replace with:

```ts
import Anthropic from "@anthropic-ai/sdk"

import { SETTINGS_DEFAULTS } from "@roo-code/types"

import { parseMentions, ParseMentionsResult, MentionContentBlock } from "./index"
```

Find:

```ts
	showRooIgnoredFiles = false,
	includeDiagnosticMessages = true,
	maxDiagnosticMessages = 50,
```

Replace with:

```ts
	showRooIgnoredFiles = SETTINGS_DEFAULTS.showRooIgnoredFiles,
	includeDiagnosticMessages = SETTINGS_DEFAULTS.includeDiagnosticMessages,
	maxDiagnosticMessages = SETTINGS_DEFAULTS.maxDiagnosticMessages,
```

8. `src/core/task/TaskLifecycle.ts`. Find:

```ts
	getMaxMcpToolsThreshold,
	TelemetryEventName,
} from "@roo-code/types"
```

Replace with:

```ts
	getMaxMcpToolsThreshold,
	SETTINGS_DEFAULTS,
	TelemetryEventName,
} from "@roo-code/types"
```

Find:

```ts
				this.access._taskApiConfigName = state?.currentApiConfigName ?? "default"
```

Replace with:

```ts
				this.access._taskApiConfigName = state?.currentApiConfigName ?? SETTINGS_DEFAULTS.currentApiConfigName
```

Find (in the `catch` right below):

```ts
			if (this.access._taskApiConfigName === undefined) {
				this.access._taskApiConfigName = "default"
```

Replace with:

```ts
			if (this.access._taskApiConfigName === undefined) {
				this.access._taskApiConfigName = SETTINGS_DEFAULTS.currentApiConfigName
```

9. `src/extension/api.ts`. Find:

```ts
	RooCodeEventName,
	isSecretStateKey,
} from "@roo-code/types"
```

Replace with:

```ts
	RooCodeEventName,
	SETTINGS_DEFAULTS,
	isSecretStateKey,
} from "@roo-code/types"
```

Find:

```ts
		await this.sidebarProvider.providerSettingsManager.saveConfig(values.currentApiConfigName || "default", values)
```

Replace with (keep `||`: an empty profile name is not a valid name, so "" must also fall back):

```ts
		await this.sidebarProvider.providerSettingsManager.saveConfig(
			values.currentApiConfigName || SETTINGS_DEFAULTS.currentApiConfigName,
			values,
		)
```

10. `src/core/task/TaskAskSay.ts`. Find:

```ts
	isResumableAsk,
} from "@roo-code/types"
```

Replace with:

```ts
	isResumableAsk,
	SETTINGS_DEFAULTS,
} from "@roo-code/types"
```

Find and DELETE this whole block (no other user; verified with
`grep -rn SUBAGENT_ASK_FALLBACK_TIMEOUT_MS --include=*.ts --include=*.tsx . | grep -v node_modules`):

```ts
/**
 * How long a headless subagent's interactive ask (followup question) may wait
 * for a user answer before falling back to a plain approval. Keeps unattended
 * fan-outs bounded while giving a watching user a real window to reply.
 */
export const SUBAGENT_ASK_FALLBACK_TIMEOUT_MS = 5 * 60 * 1000
```

Find:

```ts
				(state?.subagentFollowupTimeoutSec ?? SUBAGENT_ASK_FALLBACK_TIMEOUT_MS / 1000) * 1000,
```

Replace with:

```ts
				(state?.subagentFollowupTimeoutSec ?? SETTINGS_DEFAULTS.subagentFollowupTimeoutSec) * 1000,
```

If deleting the constant leaves an empty line pair or an unused `pWaitFor` import warning, fix only the blank lines
(prettier will do it); `pWaitFor` is used elsewhere in the file.

11. Docs: `docs/architecture.md` needs no change (it already states the rule). Nothing else.

## 7. Tests to add or change

A. New file `src/core/task/__tests__/RetryHandler.spec.ts` (the lowest layer: a pure calculation). Full content:

```ts
import { SETTINGS_DEFAULTS } from "@roo-code/types"

import { RetryHandler, setLastGlobalApiRequestTime, type RetryHandlerAccess } from "../RetryHandler"

const makeHandler = () => new RetryHandler({ apiConfiguration: {} } as unknown as RetryHandlerAccess)
const error = new Error("API Error")

describe("RetryHandler.calculateBackoffDelay", () => {
	beforeEach(() => {
		// 0 means "no request yet", so the provider rate limit adds nothing.
		setLastGlobalApiRequestTime(0)
	})

	it("starts at the table default when the state has no requestDelaySeconds", () => {
		expect(SETTINGS_DEFAULTS.requestDelaySeconds).toBe(5)
		expect(makeHandler().calculateBackoffDelay(0, error, {})).toBe(SETTINGS_DEFAULTS.requestDelaySeconds)
	})

	it("starts at the table default when there is no state at all", () => {
		expect(makeHandler().calculateBackoffDelay(0, error, undefined)).toBe(SETTINGS_DEFAULTS.requestDelaySeconds)
	})

	it("uses the stored value and doubles it per attempt", () => {
		const handler = makeHandler()
		expect(handler.calculateBackoffDelay(0, error, { requestDelaySeconds: 3 })).toBe(3)
		expect(handler.calculateBackoffDelay(2, error, { requestDelaySeconds: 3 })).toBe(12)
	})

	it("never retries without backoff: 0 falls back to the default", () => {
		expect(makeHandler().calculateBackoffDelay(0, error, { requestDelaySeconds: 0 })).toBe(
			SETTINGS_DEFAULTS.requestDelaySeconds,
		)
	})
})
```

Why it fails without the fix: before step 1, `SETTINGS_DEFAULTS.requestDelaySeconds` is `undefined`, so the first
`expect(...).toBe(5)` fails (and `tsc` reports the property as missing).

B. `src/core/webview/__tests__/ClineProvider.stateBuilder.spec.ts`: add one test inside the top-level `describe`
that owns `makeProvider` (put it right after the `describe.each(fixtures)(...)` block, before its closing `})`;
use the same `makeProvider` helper the golden tests use):

```ts
	it("getState() carries a stored requestDelaySeconds, so the retry backoff honours it", async () => {
		const provider = await makeProvider({ cloudMode: "signedOut", settings: { requestDelaySeconds: 12 } })
		expect((await provider.getState()).requestDelaySeconds).toBe(12)
	})

	it("getState() gives requestDelaySeconds its default when unset", async () => {
		const provider = await makeProvider({ cloudMode: "signedOut" })
		expect((await provider.getState()).requestDelaySeconds).toBe(5)
	})
```

Before writing it, open the file and check the signature of `makeProvider` (it takes a fixture
`{ cloudMode: CloudMode; settings?: RooCodeSettings }`, see the `fixtures` array near line 422). If its signature
differs, adapt only the argument. Why it fails without the fix: `getState()` drops `requestDelaySeconds` (not in
`SETTINGS_DEFAULT_KEYS` nor in `PASSTHROUGH_SETTING_KEYS`), so the first test gets `undefined`.

C. `packages/types/src/__tests__/settings-defaults.spec.ts`: step 2 above.

D. Snapshots: `src/core/webview/__tests__/__snapshots__/ClineProvider.stateBuilder.spec.ts.snap` gains
`"requestDelaySeconds": 5,` in every entry. Update with `-u` only after reading the diff (section 8).

## 8. Commands to run (exact, from which directory) and the expected result

1. Prove the new tests fail first (before any source change, after only writing the test files A and B):
   `cd /home/user/Tumble-Code/src && npx vitest run core/task/__tests__/RetryHandler.spec.ts core/webview/__tests__/ClineProvider.stateBuilder.spec.ts -t "requestDelaySeconds|calculateBackoffDelay"`
   Expected: RetryHandler "starts at the table default..." fails (expected undefined to be 5) and the
   "carries a stored requestDelaySeconds" test fails (undefined vs 12).
2. Apply section 6.
3. `cd /home/user/Tumble-Code/packages/types && npx vitest run src/__tests__/settings-defaults.spec.ts` -> pass.
4. `cd /home/user/Tumble-Code/src && npx vitest run core/task/__tests__/RetryHandler.spec.ts` -> 4 pass.
5. `cd /home/user/Tumble-Code/src && npx vitest run core/webview/__tests__/ClineProvider.stateBuilder.spec.ts`
   -> the golden snapshot tests fail with ONLY `+ "requestDelaySeconds": 5,` lines (or `12`/the fixture value if the
   `FULL_SETTINGS` fixture has one). Read the diff. If so:
   `npx vitest run core/webview/__tests__/ClineProvider.stateBuilder.spec.ts -u` then run again -> pass.
6. `cd /home/user/Tumble-Code/src && npx vitest run core/webview/__tests__/webviewMessageHandler.routing.spec.ts`
   -> if it fails, same rule as step 5 (only added `requestDelaySeconds` lines) then `-u`.
7. `cd /home/user/Tumble-Code/src && npx vitest run core/task core/webview core/tools core/mentions extension`
   -> all pass (compare against a run on origin/main if anything fails, to rule out pre-existing failures).
8. `cd /home/user/Tumble-Code/webview-ui && npx vitest run src/components/settings/__tests__/schema.spec.ts` -> pass
   (it compares schema defaults with the table; the new key has no webview row, so no drift).
9. Type check: `cd /home/user/Tumble-Code/src && pnpm check-types`; `cd /home/user/Tumble-Code/packages/types && pnpm check-types`;
   `cd /home/user/Tumble-Code/webview-ui && pnpm check-types` -> no errors.
10. Lint: `cd /home/user/Tumble-Code/src && npx eslint core/task/RetryHandler.ts core/task/TaskApiLoop.ts core/webview/ClineProvider.ts core/tools/ExecuteCommandTool.ts core/mentions/processUserContentMentions.ts core/task/TaskLifecycle.ts extension/api.ts core/task/TaskAskSay.ts core/task/__tests__/RetryHandler.spec.ts core/webview/__tests__/ClineProvider.stateBuilder.spec.ts --max-warnings=0`
    and `cd /home/user/Tumble-Code/packages/types && npx eslint src/settings-defaults.ts src/__tests__/settings-defaults.spec.ts --max-warnings=0`.
11. Prettier: `cd /home/user/Tumble-Code && npx prettier --check <every changed file>`.

## 9. Do not touch / pitfalls

- `ClineProvider.postStateToWebview*` and `clineMessagesSeq` (do-not-touch list): not touched by this WP. The block
  changed in `ClineProvider` is in `resolveWebviewView`.
- The global `lastGlobalApiRequestTime` rate limit (do-not-touch): only read by the new test through the existing
  exported setter; do not change `setLastGlobalApiRequestTime` / `getLastGlobalApiRequestTime`.
- Do not convert `|| 5` into a plain `?? 5`/`?? SETTINGS_DEFAULTS...`: 0 would then mean "retry immediately".
- Do not replace container defaults (`= {}`, `= []`, `|| []`) with the frozen table values.
- Do not touch the webview files listed in section 5 (separate item).
- `Task.spec.ts` tests mock `getState` with `requestDelaySeconds: 3` and `0`; they must keep passing (3 -> countdown
  3,2,1; 0 -> tests do not reach a retry).
- F1 (cli-integration resume case) and F2 (Windows TaskHistoryStore lock count) are known flaky; not affected.

## 10. Acceptance checklist (checkboxes)

- [ ] `SETTINGS_DEFAULTS.requestDelaySeconds === 5`.
- [ ] `grep -rnE "requestDelaySeconds \|\| 5|autoCondenseContext = true|autoCondenseContextPercent = 100" src --include=*.ts | grep -v __tests__` prints nothing.
- [ ] Every site in section 5's list uses `SETTINGS_DEFAULTS.<key>`; `SUBAGENT_ASK_FALLBACK_TIMEOUT_MS` is gone.
- [ ] New `RetryHandler.spec.ts` and the two stateBuilder tests pass; they failed before the change.
- [ ] Snapshot diffs contain only `requestDelaySeconds` lines.
- [ ] check-types, eslint, prettier clean.
- [ ] Changeset and ai_plans note added.

## 11. Commit, changeset and PR text

Commit title: `refactor(settings): read setting defaults from SETTINGS_DEFAULTS at call sites (D2)`

Body:

```
Replace literal defaults (= true, ?? "default", || 5) in src/ with
SETTINGS_DEFAULTS.<key>. Add requestDelaySeconds (5) to the table, so
getState() carries it: an imported retry delay was silently ignored and the
backoff always started at 5 s. A stored 0 still falls back to the default,
so a retry never runs without backoff.

<the commit attribution trailers your harness requires>
```

`.changeset/d2-settings-defaults-call-sites.md`:

```
---
"tumble-code": patch
---

A retry delay set through "Import settings" (`requestDelaySeconds`) is now used for the API retry backoff. It was
ignored before and the first retry always waited 5 seconds.
```

`ai_plans/2026-MM-DD_d2-settings-defaults-call-sites.md` (use the date of the PR):

```
# D2: setting defaults at call sites

Item D2 of `2026-09-27_simplification-roadmap.md`.

## Problem
Host code wrote setting defaults as literals (`autoCondenseContext = true`, `|| 5`, `?? "default"`) instead of
reading `SETTINGS_DEFAULTS`. `requestDelaySeconds` had no row in the table and was not in `getState()`, so the
imported value never reached `RetryHandler`.

## Change
Table row `requestDelaySeconds: 5`; every literal in src/ replaced (list in the PR). A stored 0 keeps falling
back to the default. `SUBAGENT_ASK_FALLBACK_TIMEOUT_MS` removed (same value as the table). Webview literals are
left for a follow-up (they include `TerminalSettings.tsx` showing `?? 50` ms for a 0 default).

## Tests
`RetryHandler.spec.ts` (default, stored value, doubling, 0), two `ClineProvider.stateBuilder.spec.ts` cases,
table assertion in `settings-defaults.spec.ts`; golden snapshots gain `requestDelaySeconds`.
```

PR body outline: Summary (what and why, the requestDelaySeconds bug); list of changed call sites; "Not changed"
(container defaults, named constants, webview follow-up); Tests; snapshot note; then

```
(the PR attribution footer your harness requires, see 00-README.md, section 3)

```

## 12. If stuck

- If a golden snapshot diff shows anything other than added `requestDelaySeconds` lines, stop and report the diff.
- If `tsc` complains that `state?.requestDelaySeconds` is not on the state type in `RetryHandler` (it is typed
  `any`, so it should not), report instead of adding casts elsewhere.
- If any existing test in `core/task` asserts a retry countdown starting at 5 with a mocked state that has no
  `requestDelaySeconds`, it still passes (default is 5); if one fails, report its name and output.
