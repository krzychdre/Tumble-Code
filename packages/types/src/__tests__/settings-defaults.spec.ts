import {
	ARTIFACT_SPILL_DEFAULTS,
	CODEBASE_INDEX_CONFIG_DEFAULTS,
	DEFAULT_ENABLE_CHECKPOINTS,
	DEFAULT_SOUND_ENABLED,
	DEFAULT_TERMINAL_SHELL_INTEGRATION_TIMEOUT_MS,
	GLOBAL_SETTINGS_KEYS,
	PRUNE_CONDENSE_DEFAULTS,
	SETTINGS_DEFAULTS,
	resolveSettings,
} from "../index.js"

describe("SETTINGS_DEFAULTS", () => {
	it("only lists real global settings keys", () => {
		const known = new Set<string>(GLOBAL_SETTINGS_KEYS)
		expect(Object.keys(SETTINGS_DEFAULTS).filter((key) => !known.has(key))).toEqual([])
	})

	it("carries the owner-decided values (decisions 4a and 4b) and the values the host used to hard-code", () => {
		expect(SETTINGS_DEFAULTS.terminalShellIntegrationTimeout).toBe(DEFAULT_TERMINAL_SHELL_INTEGRATION_TIMEOUT_MS)
		expect(SETTINGS_DEFAULTS.terminalShellIntegrationTimeout).toBe(30_000)
		expect(SETTINGS_DEFAULTS.soundEnabled).toBe(DEFAULT_SOUND_ENABLED)
		expect(SETTINGS_DEFAULTS.soundEnabled).toBe(false)
		expect(SETTINGS_DEFAULTS.enableCheckpoints).toBe(DEFAULT_ENABLE_CHECKPOINTS)
		expect(SETTINGS_DEFAULTS.enableCheckpoints).toBe(true)
		expect(SETTINGS_DEFAULTS.soundVolume).toBe(0.5)
		expect(SETTINGS_DEFAULTS.telemetrySetting).toBe("unset")
		expect(SETTINGS_DEFAULTS.maxDiagnosticMessages).toBe(50)
		expect(SETTINGS_DEFAULTS.customSoundCelebration).toBeNull()
	})

	it("is frozen, including its containers", () => {
		expect(Object.isFrozen(SETTINGS_DEFAULTS)).toBe(true)
		expect(Object.isFrozen(SETTINGS_DEFAULTS.listApiConfigMeta)).toBe(true)
		expect(Object.isFrozen(SETTINGS_DEFAULTS.customModePrompts)).toBe(true)
	})
})

describe("resolveSettings", () => {
	it("fills every table key when nothing is set", () => {
		const resolved = resolveSettings({})
		for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
			expect(resolved[key as keyof typeof resolved], key).toEqual(value)
		}
	})

	it("treats null like unset", () => {
		expect(resolveSettings({ customSoundCelebration: null }).customSoundCelebration).toBeNull()
		expect(resolveSettings({ soundVolume: null as unknown as number }).soundVolume).toBe(0.5)
	})

	it("keeps explicit falsy values instead of replacing them", () => {
		const resolved = resolveSettings({
			autoCondenseContext: false,
			terminalCommandDelay: 0,
			searxngBaseUrl: "",
			mcpEnabled: false,
			soundVolume: 0,
		})
		expect(resolved.autoCondenseContext).toBe(false)
		expect(resolved.terminalCommandDelay).toBe(0)
		expect(resolved.searxngBaseUrl).toBe("")
		expect(resolved.mcpEnabled).toBe(false)
		expect(resolved.soundVolume).toBe(0)
	})

	it("passes keys without a default through untouched", () => {
		const resolved = resolveSettings({ customInstructions: "Be terse.", allowedMaxRequests: 3 })
		expect(resolved.customInstructions).toBe("Be terse.")
		expect(resolved.allowedMaxRequests).toBe(3)
		expect(resolveSettings({})).not.toHaveProperty("customInstructions")
	})

	it("hands out fresh containers, so a caller cannot change the table or another result", () => {
		const first = resolveSettings({})
		first.listApiConfigMeta.push({ id: "x", name: "x" })
		first.customModePrompts.code = { roleDefinition: "changed" }
		const second = resolveSettings({})
		expect(second.listApiConfigMeta).toEqual([])
		expect(second.customModePrompts).toEqual({})
		expect(SETTINGS_DEFAULTS.listApiConfigMeta).toEqual([])
	})

	it("applies the clamping resolvers of the spill and prune settings", () => {
		expect(resolveSettings({}).maxInlineToolResultBytes).toBe(ARTIFACT_SPILL_DEFAULTS.DEFAULT_INLINE_TOOL_RESULT_BYTES)
		expect(resolveSettings({ maxInlineToolResultBytes: 1 }).maxInlineToolResultBytes).toBe(
			ARTIFACT_SPILL_DEFAULTS.MIN_INLINE_TOOL_RESULT_BYTES,
		)
		expect(resolveSettings({}).pruneBeforeCondense).toBe(true)
		expect(resolveSettings({ pruneBeforeCondense: false }).pruneBeforeCondense).toBe(false)
		expect(resolveSettings({}).pruneToolResultBudget).toBe(PRUNE_CONDENSE_DEFAULTS.DEFAULT_TOOL_RESULT_BUDGET)
	})

	it("resolves the code-index config field by field and leaves the embedding dimension unset", () => {
		expect(resolveSettings({}).codebaseIndexConfig).toEqual({
			...CODEBASE_INDEX_CONFIG_DEFAULTS,
			codebaseIndexEmbedderModelDimension: undefined,
			codebaseIndexOpenAiCompatibleBaseUrl: undefined,
			codebaseIndexSearchMaxResults: undefined,
			codebaseIndexSearchMinScore: undefined,
			codebaseIndexBedrockRegion: undefined,
			codebaseIndexBedrockProfile: undefined,
			codebaseIndexOpenRouterSpecificProvider: undefined,
		})
		const resolved = resolveSettings({
			codebaseIndexConfig: { codebaseIndexEmbedderProvider: "ollama", codebaseIndexEmbedderModelDimension: 768 },
		}).codebaseIndexConfig
		expect(resolved.codebaseIndexEmbedderProvider).toBe("ollama")
		expect(resolved.codebaseIndexEmbedderModelDimension).toBe(768)
		expect(resolved.codebaseIndexQdrantUrl).toBe(CODEBASE_INDEX_CONFIG_DEFAULTS.codebaseIndexQdrantUrl)
	})
})
