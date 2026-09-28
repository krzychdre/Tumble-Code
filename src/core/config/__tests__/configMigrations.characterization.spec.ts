// npx vitest core/config/__tests__/configMigrations.characterization.spec.ts
//
// Characterization tests for the start-up migrations run by
// ProviderSettingsManager.initialize() and ContextProxy.initialize().
// They feed each legacy storage shape into a fake VS Code storage, pin the
// migrated result, and prove three properties:
//   1. the migrated result for every legacy shape that is still migrated,
//   2. a second start does not write or change anything,
//   3. a start whose final write fails leaves state that is safe to migrate
//      again (every migration is idempotent), with the same end result.
// The old one-time migrations (five provider-profile ones, image-generation
// settings, both condensing prompt ones) were deleted
// (ai_plans/2026-09-28_delete-old-config-migrations.md); the tests below also
// pin that their legacy keys are now left exactly as stored.

import * as vscode from "vscode"

import { ProviderSettingsManager } from "../ProviderSettingsManager"
import { ContextProxy } from "../ContextProxy"

vi.mock("vscode", () => ({
	Uri: { file: vi.fn((p) => ({ path: p })) },
	ExtensionMode: { Development: 1, Production: 2, Test: 3 },
}))

const API_CONFIG_KEY = "roo_cline_config_api_config"
const PROFILE_SECRETS_KEY = "roo_cline_config_provider_profile_secrets_v2"

type FakeStorage = {
	context: vscode.ExtensionContext
	state: Map<string, unknown>
	secrets: Map<string, string>
	globalStateUpdate: ReturnType<typeof vi.fn>
	secretsStore: ReturnType<typeof vi.fn>
	secretsDelete: ReturnType<typeof vi.fn>
	failSecretWritesFor: Set<string>
	failStateWritesFor: Set<string>
}

/**
 * In-memory stand-in for ExtensionContext.globalState and .secrets that keeps
 * what was written, so a second `initialize()` sees the first one's result
 * exactly as a restarted extension would.
 */
function makeStorage(initialState: Record<string, unknown> = {}, initialSecrets: Record<string, string> = {}) {
	const state = new Map<string, unknown>(Object.entries(initialState))
	const secrets = new Map<string, string>(Object.entries(initialSecrets))
	const failSecretWritesFor = new Set<string>()
	const failStateWritesFor = new Set<string>()

	const globalStateUpdate = vi.fn(async (key: string, value: unknown) => {
		if (failStateWritesFor.has(key)) throw new Error(`state write failed: ${key}`)
		if (value === undefined) state.delete(key)
		else state.set(key, structuredClone(value))
	})
	const secretsStore = vi.fn(async (key: string, value: string) => {
		if (failSecretWritesFor.has(key)) throw new Error(`secret write failed: ${key}`)
		secrets.set(key, value)
	})
	const secretsDelete = vi.fn(async (key: string) => {
		if (failSecretWritesFor.has(key)) throw new Error(`secret delete failed: ${key}`)
		secrets.delete(key)
	})

	const context = {
		globalState: {
			get: vi.fn((key: string, defaultValue?: unknown) =>
				state.has(key) ? structuredClone(state.get(key)) : defaultValue,
			),
			update: globalStateUpdate,
			keys: () => [...state.keys()],
		},
		secrets: {
			get: vi.fn(async (key: string) => secrets.get(key)),
			store: secretsStore,
			delete: secretsDelete,
		},
		extensionUri: { path: "/test/extension" },
		extensionPath: "/test/extension",
		globalStorageUri: { path: "/test/storage" },
		logUri: { path: "/test/logs" },
		extension: { packageJSON: { version: "1.0.0" } },
		extensionMode: 1,
	} as unknown as vscode.ExtensionContext

	return {
		context,
		state,
		secrets,
		globalStateUpdate,
		secretsStore,
		secretsDelete,
		failSecretWritesFor,
		failStateWritesFor,
	} satisfies FakeStorage
}

/** Start the manager once (constructor start + explicit start, serialized by its lock). */
async function startProviderSettingsManager(storage: FakeStorage) {
	const manager = new ProviderSettingsManager(storage.context)
	await manager.initialize()
	return manager
}

const storedEnvelope = (storage: FakeStorage) => JSON.parse(storage.secrets.get(API_CONFIG_KEY)!)
const storedProfileSecrets = (storage: FakeStorage) =>
	storage.secrets.has(PROFILE_SECRETS_KEY) ? JSON.parse(storage.secrets.get(PROFILE_SECRETS_KEY)!) : undefined

/** A pre-v2 (flat) envelope with no `migrations` record: every provider-profile migration applies. */
const legacyFlatProfiles = () => ({
	currentApiConfigName: "main",
	apiConfigs: {
		main: {
			id: "id-main",
			apiProvider: "anthropic",
			apiModelId: "claude-sonnet-4-5",
			apiKey: "sk-ant-legacy",
		},
		compat: {
			id: "id-compat",
			apiProvider: "openai",
			openAiBaseUrl: "https://llm.example.com/v1",
			openAiModelId: "local-model",
			openAiHostHeader: "llm.internal",
			openAiApiKey: "sk-openai-legacy",
		},
		keepsOwnValues: {
			id: "id-keeps",
			apiProvider: "anthropic",
			rateLimitSeconds: 9,
			consecutiveMistakeLimit: 5,
			todoListEnabled: false,
		},
		oldClaudeCode: {
			id: "id-cc",
			apiProvider: "claude-code",
			apiModelId: "claude-sonnet-4-5",
			claudeCodePath: "/usr/local/bin/claude",
			claudeCodeMaxOutputTokens: 8000,
		},
	},
})

/** The flags of the deleted provider-profile migrations, still accepted in stored envelopes. */
const RETIRED_FLAGS = [
	"rateLimitSecondsMigrated",
	"openAiHeadersMigrated",
	"consecutiveMistakeLimitMigrated",
	"todoListEnabledMigrated",
	"claudeCodeLegacySettingsMigrated",
] as const

describe("config migrations characterization: ProviderSettingsManager", () => {
	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(console, "log").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("fresh install: no stored profiles are written and nothing is migrated", async () => {
		const storage = makeStorage()
		await startProviderSettingsManager(storage)
		expect(storage.secretsStore).not.toHaveBeenCalled()
		expect(storage.secrets.size).toBe(0)
	})

	it("legacy flat profiles: upgraded to v2 with secrets seeded, retired legacy fields left as stored", async () => {
		const storage = makeStorage({ rateLimitSeconds: 7 }, { [API_CONFIG_KEY]: JSON.stringify(legacyFlatProfiles()) })
		await startProviderSettingsManager(storage)

		const envelope = storedEnvelope(storage)
		expect(envelope.schemaVersion).toBe(2)
		expect(envelope.data.migrations).toEqual({})
		const configs = envelope.data.apiConfigs
		// No global rate limit copied, no defaults filled in.
		expect(configs.main.shared).toBeUndefined()
		expect(configs.keepsOwnValues.shared).toEqual({
			rateLimitSeconds: 9,
			consecutiveMistakeLimit: 5,
			todoListEnabled: false,
		})
		// openAiHostHeader is not turned into openAiHeaders any more.
		expect(configs.compat.provider.config.openAiHostHeader).toBe("llm.internal")
		expect(configs.compat.provider.config.openAiHeaders).toBeUndefined()
		// The removed Claude Code CLI keys stay in the opaque payload.
		expect(configs.oldClaudeCode.provider.opaqueLegacyPayload).toMatchObject({
			claudeCodePath: "/usr/local/bin/claude",
			claudeCodeMaxOutputTokens: 8000,
		})
		expect(storedProfileSecrets(storage)).toEqual({
			"id-compat": { openAiApiKey: "sk-openai-legacy" },
			"id-main": { apiKey: "sk-ant-legacy" },
		})
	})

	it("a second start writes nothing and changes nothing", async () => {
		const storage = makeStorage({ rateLimitSeconds: 7 }, { [API_CONFIG_KEY]: JSON.stringify(legacyFlatProfiles()) })
		await startProviderSettingsManager(storage)
		const afterFirst = new Map(storage.secrets)
		storage.secretsStore.mockClear()
		storage.secretsDelete.mockClear()
		storage.globalStateUpdate.mockClear()

		await startProviderSettingsManager(storage)

		expect(storage.secretsStore).not.toHaveBeenCalled()
		expect(storage.secretsDelete).not.toHaveBeenCalled()
		expect(storage.globalStateUpdate).not.toHaveBeenCalled()
		expect(storage.secrets).toEqual(afterFirst)
	})

	it.each([true, false])(
		"a v2 envelope carrying every retired flag (%s) still loads, keeps the flags and is not rewritten",
		async (flagValue) => {
			const seed = makeStorage({}, { [API_CONFIG_KEY]: JSON.stringify(legacyFlatProfiles()) })
			await startProviderSettingsManager(seed)
			const withRetiredFlags = storedEnvelope(seed)
			withRetiredFlags.data.migrations = Object.fromEntries(RETIRED_FLAGS.map((flag) => [flag, flagValue]))

			const storage = makeStorage({ rateLimitSeconds: 7 }, { [API_CONFIG_KEY]: JSON.stringify(withRetiredFlags) })
			const manager = await startProviderSettingsManager(storage)

			expect(storage.secretsStore).not.toHaveBeenCalled()
			expect(storedEnvelope(storage)).toEqual(withRetiredFlags)
			expect((await manager.listConfig()).map((entry) => entry.name).sort()).toEqual([
				"compat",
				"keepsOwnValues",
				"main",
				"oldClaudeCode",
			])
		},
	)

	it("mid-crash: when the upgrade write fails, the next start reaches the same result", async () => {
		const reference = makeStorage(
			{ rateLimitSeconds: 7 },
			{ [API_CONFIG_KEY]: JSON.stringify(legacyFlatProfiles()) },
		)
		await startProviderSettingsManager(reference)

		const storage = makeStorage({ rateLimitSeconds: 7 }, { [API_CONFIG_KEY]: JSON.stringify(legacyFlatProfiles()) })
		storage.failSecretWritesFor.add(API_CONFIG_KEY)
		const crashed = new ProviderSettingsManager(storage.context)
		await expect(crashed.initialize()).rejects.toThrow("Failed to initialize config")
		// Nothing recorded: the legacy envelope is still what is stored.
		expect(JSON.parse(storage.secrets.get(API_CONFIG_KEY)!)).toEqual(legacyFlatProfiles())

		storage.failSecretWritesFor.clear()
		await startProviderSettingsManager(storage)

		expect(storedEnvelope(storage)).toEqual(storedEnvelope(reference))
		expect(storedProfileSecrets(storage)).toEqual(storedProfileSecrets(reference))
	})
})

/** Minimal text that the deleted v1-default condensing prompt cleanup used to recognize. */
const V1_DEFAULT_CONDENSE_PROMPT = [
	"Your task is to create a detailed summary of the conversation so far.",
	"1. Previous Conversation:",
	"2. Current Work:",
	"3. Key Technical Concepts:",
	"4. Relevant Files and Code:",
	"5. Problem Solving:",
	"6. Pending Tasks and Next Steps:",
	"Output only the summary of the conversation so far.",
].join("\n")

const sortedState = (storage: FakeStorage) => Object.fromEntries([...storage.state.entries()].sort())
const sortedSecrets = (storage: FakeStorage) => Object.fromEntries([...storage.secrets.entries()].sort())

/** Legacy keys of the deleted ContextProxy migrations: now left exactly as stored. */
const retiredLegacyState = () => ({
	openRouterImageGenerationSettings: {
		openRouterApiKey: "sk-or-image",
		selectedModel: "google/gemini-2.5-flash-image-preview",
	},
	customCondensingPrompt: "My own condensing prompt",
	customSupportPrompts: { CONDENSE: V1_DEFAULT_CONDENSE_PROMPT },
})

/** Every legacy shape ContextProxy.initialize() still migrates, plus the retired keys. */
const legacyGlobalState = () => ({
	...retiredLegacyState(),
	vertexJsonCredentials: '{"type":"service_account"}',
	apiProvider: "no-such-provider",
	autoMemoryDirectory: "relative/not-allowed",
})

describe("config migrations characterization: ContextProxy", () => {
	it("migrates every legacy global-state shape that is still migrated and leaves retired keys alone", async () => {
		const storage = makeStorage(legacyGlobalState())
		const proxy = new ContextProxy(storage.context)
		await proxy.initialize()

		expect(sortedState(storage)).toEqual({
			...retiredLegacyState(),
			autoDreamEnabled: true,
			autoDreamMinHours: 24,
			autoDreamMinSessions: 5,
			autoMemoryEnabled: true,
			memoryRecallEnabled: true,
		})
		expect(sortedSecrets(storage)).toEqual({ vertexJsonCredentials: '{"type":"service_account"}' })
		expect(proxy.getSecret("openRouterImageApiKey")).toBeUndefined()
		expect(proxy.getSecret("vertexJsonCredentials")).toBe('{"type":"service_account"}')
		expect(proxy.getGlobalState("apiProvider")).toBeUndefined()
		expect(proxy.getGlobalState("customSupportPrompts")).toEqual({ CONDENSE: V1_DEFAULT_CONDENSE_PROMPT })
		expect(proxy.getGlobalState("openRouterImageGenerationSelectedModel")).toBeUndefined()
	})

	it("a second start writes nothing and changes nothing", async () => {
		const storage = makeStorage(legacyGlobalState())
		await new ContextProxy(storage.context).initialize()
		const stateAfterFirst = sortedState(storage)
		const secretsAfterFirst = sortedSecrets(storage)
		storage.globalStateUpdate.mockClear()
		storage.secretsStore.mockClear()
		storage.secretsDelete.mockClear()

		await new ContextProxy(storage.context).initialize()

		expect(storage.globalStateUpdate).not.toHaveBeenCalled()
		expect(storage.secretsStore).not.toHaveBeenCalled()
		expect(storage.secretsDelete).not.toHaveBeenCalled()
		expect(sortedState(storage)).toEqual(stateAfterFirst)
		expect(sortedSecrets(storage)).toEqual(secretsAfterFirst)
	})

	it("keeps a user's explicit memory choices", async () => {
		const storage = makeStorage({
			autoMemoryEnabled: false,
			autoDreamEnabled: false,
			memoryRecallEnabled: false,
			autoDreamMinHours: 3,
			autoDreamMinSessions: 1,
			apiProvider: "anthropic",
		})
		await new ContextProxy(storage.context).initialize()
		expect(sortedState(storage)).toEqual({
			apiProvider: "anthropic",
			autoDreamEnabled: false,
			autoDreamMinHours: 3,
			autoDreamMinSessions: 1,
			autoMemoryEnabled: false,
			memoryRecallEnabled: false,
		})
	})

	it("does not overwrite an existing secret with a legacy plain-text copy", async () => {
		const storage = makeStorage(
			{ vertexJsonCredentials: "stale-copy" },
			{ vertexJsonCredentials: "current-secret" },
		)
		await new ContextProxy(storage.context).initialize()
		expect(sortedSecrets(storage)).toEqual({ vertexJsonCredentials: "current-secret" })
	})

	it("mid-crash: a failed write during one start leaves state that the next start migrates to the same result", async () => {
		const reference = makeStorage(legacyGlobalState())
		await new ContextProxy(reference.context).initialize()

		const storage = makeStorage(legacyGlobalState())
		// Every clean-up write of a legacy key fails on the first start.
		for (const key of ["vertexJsonCredentials", "apiProvider", "autoMemoryEnabled"]) {
			storage.failStateWritesFor.add(key)
		}
		await expect(new ContextProxy(storage.context).initialize()).resolves.toBeUndefined()

		storage.failStateWritesFor.clear()
		await new ContextProxy(storage.context).initialize()

		expect(sortedState(storage)).toEqual(sortedState(reference))
		expect(sortedSecrets(storage)).toEqual(sortedSecrets(reference))
	})
})
