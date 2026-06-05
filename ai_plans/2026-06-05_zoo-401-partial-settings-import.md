# Port Zoo PR #401 — Handle partial settings import failures per key

- **Zoo PR:** #401 — `Handle partial settings import failures per key`
- **Zoo commit:** `00fc24734`
- **Merged:** 2026-06-05 (01:01Z)
- **Our branch:** `feature/zoo-401-partial-settings-import` (off `main`)
- **Category:** robustness/settings · Size **M** · Risk **low-medium**

## 0. Credit (carry into the commit)

Original author: **T (taltas)**. The commit message MUST end with:

```
Co-authored-by: T <taltas@users.noreply.github.com>
```

## 1. Goal (one sentence)

Validate imported `globalSettings` **per key** so one invalid/unknown key is
skipped with a warning instead of aborting the entire settings import.

## 2. Root cause (reproduced with evidence)

[importExport.ts:86](src/core/config/importExport.ts#L86) declares
`globalSettings: globalSettingsSchema.optional()` and
[:93](src/core/config/importExport.ts#L93) does
`lenientSchema.parse(rawData)`. Zod validates the **whole** `globalSettings`
object, so a single bad key throws a `ZodError`, caught at
[:186](src/core/config/importExport.ts#L186), returning `{ success: false }` —
**nothing** is imported (not provider profiles, not the valid global keys).

Proven by direct repro (throwaway tsx against our real schema):
`{ customInstructions: "KEEP ME", autoApprovalEnabled: true, requestDelaySeconds: "slow" }`
→ `THREW … [globalSettings.requestDelaySeconds] Expected number, received string`,
and the two valid keys are lost.

## 3. Deliberate divergence from upstream (rebrand landmine)

Upstream special-cases `imageGenerationProvider === "roo"` to clear it with a
"roo"-named message. **We drop that branch entirely.** Our schema is
`imageGenerationProvider: z.literal("openrouter").optional()`
([global-settings.ts:92](packages/types/src/global-settings.ts#L92)), so `"roo"`
is simply an invalid value — the generic per-key validator skips it with a
warning. Re-adding a `"roo"` branch would reintroduce Roo branding (forbidden by
our rebrand) and is unnecessary (YAGNI). Upstream's two "roo-normalize" tests are
therefore **adapted** to assert the generic skip behavior, not a "roo" message.

## 4. Scope (YAGNI)

In scope — only:

1. `src/core/config/importExport.ts`: add a per-key `sanitizeGlobalSettings()`
    - `formatZodIssues()` helper; switch `lenientSchema.globalSettings` to
      `z.unknown().optional()`; use the sanitized result for `customModes`,
      `setValues`, and the return value; retitle the toast `profile(s)` → `item(s)`.
2. `src/utils/autoImportSettings.ts`: log any returned `warnings` to the output
   channel on success.
3. Tests for both.

Out of scope: no UI changes, no new i18n keys (toast text is inline English
today — keep it inline), no provider-profile logic changes, **no `"roo"`
special-case**.

## 5. TDD — write tests first, watch them fail

### 5a. `src/core/config/__tests__/importExport.spec.ts`

**(i) Update the two existing wording assertions** (the toast is now generic):

- [:760](src/core/config/__tests__/importExport.spec.ts#L760)
  `"1 profile had issues during import."` → `"1 item had issues during import."`
- [:1063](src/core/config/__tests__/importExport.spec.ts#L1063)
  `"2 profiles had issues during import."` → `"2 items had issues during import."`

**(ii) Add these tests** inside the existing `describe("importExport", …)` block,
next to the other `importSettings*` tests (they use the already-defined
`mockProviderSettingsManager`, `mockContextProxy`, `mockCustomModesManager`, and
the `ProviderName`/`Mock` imports already present):

```ts
it("partially imports valid global settings when invalid top-level keys are present", async () => {
	;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
	;(fs.readFile as Mock).mockResolvedValue(
		JSON.stringify({
			providerProfiles: {
				currentApiConfigName: "valid-profile",
				apiConfigs: {
					"valid-profile": { apiProvider: "openai" as ProviderName, apiKey: "test-key", id: "valid-id" },
				},
			},
			globalSettings: {
				customInstructions: "Keep this setting",
				autoApprovalEnabled: true,
				requestDelaySeconds: "slow", // invalid: expects number
				telemetrySetting: "maybe", // invalid: not in enum
			},
		}),
	)
	mockProviderSettingsManager.export.mockResolvedValue({
		currentApiConfigName: "default",
		apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
	})
	mockProviderSettingsManager.listConfig.mockResolvedValue([
		{ name: "valid-profile", id: "valid-id", apiProvider: "openai" as ProviderName },
	])

	const result = await importSettings({
		providerSettingsManager: mockProviderSettingsManager,
		contextProxy: mockContextProxy,
		customModesManager: mockCustomModesManager,
	})

	expect(result.success).toBe(true)
	expect((result as { warnings?: string[] }).warnings).toEqual(
		expect.arrayContaining([
			expect.stringContaining("globalSettings.requestDelaySeconds"),
			expect.stringContaining("globalSettings.telemetrySetting"),
		]),
	)
	expect((mockContextProxy.setValues as Mock).mock.calls[0][0]).toEqual({
		customInstructions: "Keep this setting",
		autoApprovalEnabled: true,
	})
})

it("skips an invalid imageGenerationProvider value while preserving other global settings", async () => {
	;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
	;(fs.readFile as Mock).mockResolvedValue(
		JSON.stringify({
			providerProfiles: {
				currentApiConfigName: "valid-profile",
				apiConfigs: {
					"valid-profile": { apiProvider: "openai" as ProviderName, apiKey: "test-key", id: "valid-id" },
				},
			},
			globalSettings: {
				imageGenerationProvider: "roo", // invalid: only "openrouter" is allowed in our fork
				customInstructions: "Keep this setting",
			},
		}),
	)
	mockProviderSettingsManager.export.mockResolvedValue({
		currentApiConfigName: "default",
		apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
	})
	mockProviderSettingsManager.listConfig.mockResolvedValue([
		{ name: "valid-profile", id: "valid-id", apiProvider: "openai" as ProviderName },
	])

	const result = await importSettings({
		providerSettingsManager: mockProviderSettingsManager,
		contextProxy: mockContextProxy,
		customModesManager: mockCustomModesManager,
	})

	expect(result.success).toBe(true)
	expect((result as { warnings?: string[] }).warnings).toEqual(
		expect.arrayContaining([expect.stringContaining("globalSettings.imageGenerationProvider")]),
	)
	const imported = (mockContextProxy.setValues as Mock).mock.calls[0][0]
	expect(imported).not.toHaveProperty("imageGenerationProvider")
	expect(imported.customInstructions).toBe("Keep this setting")
})

it("skips invalid customModes without aborting unrelated settings import", async () => {
	;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
	;(fs.readFile as Mock).mockResolvedValue(
		JSON.stringify({
			providerProfiles: {
				currentApiConfigName: "valid-profile",
				apiConfigs: {
					"valid-profile": { apiProvider: "openai" as ProviderName, apiKey: "test-key", id: "valid-id" },
				},
			},
			globalSettings: {
				customInstructions: "Keep this setting",
				customModes: [{ slug: "broken-mode", name: "", roleDefinition: "", groups: ["invalid-group"] }],
			},
		}),
	)
	mockProviderSettingsManager.export.mockResolvedValue({
		currentApiConfigName: "default",
		apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
	})
	mockProviderSettingsManager.listConfig.mockResolvedValue([
		{ name: "valid-profile", id: "valid-id", apiProvider: "openai" as ProviderName },
	])

	const result = await importSettings({
		providerSettingsManager: mockProviderSettingsManager,
		contextProxy: mockContextProxy,
		customModesManager: mockCustomModesManager,
	})

	expect(result.success).toBe(true)
	expect((result as { warnings?: string[] }).warnings).toEqual(
		expect.arrayContaining([expect.stringContaining("globalSettings.customModes")]),
	)
	expect(mockCustomModesManager.updateCustomMode).not.toHaveBeenCalled()
	expect(mockContextProxy.setValues).toHaveBeenCalledWith({ customInstructions: "Keep this setting" })
})

it("uses generic 'item' wording when only global settings have issues", async () => {
	const filePath = "/mock/path/settings.json"
	;(fs.readFile as Mock).mockResolvedValue(
		JSON.stringify({
			providerProfiles: {
				currentApiConfigName: "valid-profile",
				apiConfigs: {
					"valid-profile": { apiProvider: "openai" as ProviderName, apiKey: "test-key", id: "valid-id" },
				},
			},
			globalSettings: { requestDelaySeconds: "slow" },
		}),
	)
	;(fs.access as Mock).mockResolvedValue(undefined)
	mockProviderSettingsManager.export.mockResolvedValue({
		currentApiConfigName: "default",
		apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
	})
	mockProviderSettingsManager.listConfig.mockResolvedValue([
		{ name: "valid-profile", id: "valid-id", apiProvider: "openai" as ProviderName },
	])
	const mockProvider = { settingsImportedAt: 0, postStateToWebview: vi.fn().mockResolvedValue(undefined) }
	const showWarningMessageSpy = vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined)
	const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

	await importSettingsWithFeedback(
		{
			providerSettingsManager: mockProviderSettingsManager,
			contextProxy: mockContextProxy,
			customModesManager: mockCustomModesManager,
			provider: mockProvider,
		},
		filePath,
	)

	expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining("1 item had issues during import."))
	expect(showWarningMessageSpy).not.toHaveBeenCalledWith(expect.stringContaining("profile had issues"))
	expect(consoleWarnSpy).toHaveBeenCalledWith(
		"Settings import completed with warnings:",
		expect.arrayContaining([expect.stringContaining("globalSettings.requestDelaySeconds")]),
	)
	showWarningMessageSpy.mockRestore()
	consoleWarnSpy.mockRestore()
})
```

### 5b. `src/utils/__tests__/autoImportSettings.spec.ts`

Add (uses the existing `mockOutputChannel`, `mockContextProxy`,
`mockProviderSettingsManager`, `mockCustomModesManager`, `fsPromises`,
`fileExistsAtPath` from the file's setup):

```ts
it("logs import warnings while still succeeding", async () => {
	const settingsPath = "/absolute/path/to/config.json"
	vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
		get: vi.fn().mockReturnValue(settingsPath),
	} as any)
	vi.mocked(fileExistsAtPath).mockResolvedValue(true)
	vi.mocked(fsPromises.readFile).mockResolvedValue(
		JSON.stringify({
			providerProfiles: {
				currentApiConfigName: "test-config",
				apiConfigs: { "test-config": { apiProvider: "anthropic", anthropicApiKey: "test-key" } },
			},
			globalSettings: { requestDelaySeconds: "slow", customInstructions: "Test instructions" },
		}) as any,
	)

	await autoImportSettings(mockOutputChannel, {
		providerSettingsManager: mockProviderSettingsManager,
		contextProxy: mockContextProxy,
		customModesManager: mockCustomModesManager,
	})

	expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
		"[AutoImport] Successfully imported settings from /absolute/path/to/config.json",
	)
	expect(mockOutputChannel.appendLine).toHaveBeenCalledWith("[AutoImport] Import completed with 1 warning.")
	expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
		expect.stringContaining('[AutoImport] Warning: Setting "globalSettings.requestDelaySeconds"'),
	)
	expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("info.auto_import_success")
	expect(mockContextProxy.setValues).toHaveBeenCalledWith({ customInstructions: "Test instructions" })
})
```

**Run (expect RED):**

```bash
cd src && npx vitest run core/config/__tests__/importExport.spec.ts utils/__tests__/autoImportSettings.spec.ts
```

Expect: the 5 new/updated importExport assertions fail (whole-import abort →
`success:false`, `setValues` not called with the valid subset, old "profile"
wording) and the autoImport test fails (no warning lines logged yet).

## 6. Implementation — make it green

### 6a. `src/core/config/importExport.ts`

**Imports** — add `GlobalSettings` type (line 9–14 block):

```ts
import {
	globalSettingsSchema,
	providerSettingsWithIdSchema,
	isProviderName,
	type GlobalSettings,
	type ProviderSettingsWithId,
} from "@roo-code/types"
```

**Add helpers** right after `sanitizeProviderConfig` (after
[:63](src/core/config/importExport.ts#L63)):

```ts
const globalSettingsShape = globalSettingsSchema.shape as Record<keyof GlobalSettings, z.ZodTypeAny>

function formatZodIssues(error: ZodError): string {
	return error.issues.map((issue) => `[${issue.path.join(".") || "value"}]: ${issue.message}`).join(", ")
}

/**
 * Validates imported global settings one key at a time so a single invalid or
 * unknown key is skipped (with a warning) instead of aborting the whole import.
 */
function sanitizeGlobalSettings(rawGlobalSettings: unknown): {
	sanitizedGlobalSettings: GlobalSettings
	warnings: string[]
} {
	const warnings: string[] = []
	const sanitizedGlobalSettings: Record<string, unknown> = {}

	if (typeof rawGlobalSettings === "undefined") {
		return { sanitizedGlobalSettings: sanitizedGlobalSettings as GlobalSettings, warnings }
	}

	if (typeof rawGlobalSettings !== "object" || rawGlobalSettings === null || Array.isArray(rawGlobalSettings)) {
		warnings.push(
			`Setting "globalSettings" was skipped: Expected object, received ${
				Array.isArray(rawGlobalSettings) ? "array" : typeof rawGlobalSettings
			}.`,
		)
		return { sanitizedGlobalSettings: sanitizedGlobalSettings as GlobalSettings, warnings }
	}

	for (const [key, rawValue] of Object.entries(rawGlobalSettings)) {
		const path = `globalSettings.${key}`
		const schema = globalSettingsShape[key as keyof GlobalSettings]

		if (!schema) {
			warnings.push(`Setting "${path}" was skipped: Unknown setting.`)
			continue
		}

		const result = schema.safeParse(rawValue)
		if (result.success) {
			sanitizedGlobalSettings[key] = result.data
		} else {
			warnings.push(`Setting "${path}" was skipped: ${formatZodIssues(result.error)}`)
		}
	}

	return { sanitizedGlobalSettings: sanitizedGlobalSettings as GlobalSettings, warnings }
}
```

> NOTE: deliberately **no** `imageGenerationProvider === "roo"` branch (see §3).

**Switch the lenient schema** ([:84-87](src/core/config/importExport.ts#L84)):

```ts
const lenientSchema = z.object({
	providerProfiles: lenientProviderProfilesSchema,
	globalSettings: z.unknown().optional(),
})
```

**Destructure raw, not parsed** ([:93](src/core/config/importExport.ts#L93)):

```ts
const { providerProfiles: rawProviderProfiles, globalSettings: rawGlobalSettings } = lenientSchema.parse(rawData)
```

**Sanitize before customModes/setValues** — replace the `customModes` block at
[:156-164](src/core/config/importExport.ts#L156):

```ts
const { sanitizedGlobalSettings, warnings: globalSettingsWarnings } = sanitizeGlobalSettings(rawGlobalSettings)
warnings.push(...globalSettingsWarnings)

await Promise.all(
	(sanitizedGlobalSettings.customModes ?? []).map((mode) => customModesManager.updateCustomMode(mode.slug, mode)),
)

// OpenAI Compatible settings are now correctly stored in codebaseIndexConfig
// They will be imported automatically with the config - no special handling needed

await providerSettingsManager.import(providerProfiles)
await contextProxy.setValues(sanitizedGlobalSettings)
```

**Return the sanitized settings** ([:182](src/core/config/importExport.ts#L182)):

```ts
			globalSettings: sanitizedGlobalSettings,
```

**Retitle the toast** ([:334-335](src/core/config/importExport.ts#L334)):

```ts
const summary = count === 1 ? `1 item had issues during import.` : `${count} items had issues during import.`
```

### 6b. `src/utils/autoImportSettings.ts`

In the `if (result.success)` block, after the "Successfully imported" line
([:47](src/utils/autoImportSettings.ts#L47)), before the info message:

```ts
if (result.warnings && result.warnings.length > 0) {
	const count = result.warnings.length
	outputChannel.appendLine(`[AutoImport] Import completed with ${count} warning${count === 1 ? "" : "s"}.`)
	for (const warning of result.warnings) {
		outputChannel.appendLine(`[AutoImport] Warning: ${warning}`)
	}
}
```

> `result.warnings` already exists on the success return type; if TS narrows it
> away, read it as `(result as { warnings?: string[] }).warnings`.

## 7. Verify (binary acceptance criteria)

```bash
# 1. the two touched suites fully green
cd src && npx vitest run core/config/__tests__/importExport.spec.ts utils/__tests__/autoImportSettings.spec.ts
# 2. types compile
cd src && npx tsc --noEmit
cd packages/types && npx tsc --noEmit
# 3. lint touched files (run via each package's own eslint)
cd src && npx eslint core/config/importExport.ts core/config/__tests__/importExport.spec.ts utils/autoImportSettings.ts utils/__tests__/autoImportSettings.spec.ts --max-warnings=0
```

**Acceptance:** both suites green (incl. 5 new importExport tests + adapted
autoImport test + the two retitled assertions); `tsc --noEmit` clean; ESLint
clean. No `"roo"` string introduced in importExport.ts.

## 8. Commit (only after green)

```
fix(settings): import valid settings keys when others are invalid

Port of Zoo-Code PR #401. Validate imported globalSettings per key so a
single invalid or unknown key is skipped with a warning instead of aborting
the whole import; log those warnings on auto-import; retitle the summary
toast from "profile(s)" to "item(s)". Drops upstream's Roo-specific
imageGenerationProvider special-case (our schema already rejects it).

Co-authored-by: T <taltas@users.noreply.github.com>
```

Then `git push -u origin feature/zoo-401-partial-settings-import`.
