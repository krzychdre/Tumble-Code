// npx vitest src/core/config/__tests__/ProviderSettingsManager.spec.ts

import { ExtensionContext } from "vscode"

import {
	classifyProvider,
	createKnownPersistedProviderProfile,
	SECRET_STATE_KEYS,
	type PersistedProviderProfile,
	type ProviderSettings,
	type ProviderSettingsWithId,
} from "@tumble-code/types"

import { ProviderSettingsManager, ProviderProfiles } from "../ProviderSettingsManager"

/**
 * The stored (v2) form of a flat test fixture. A known provider goes through the
 * production translation; a profile without a usable provider (none, retired or
 * unknown) becomes an opaque profile, as `saveConfig()` stores it. Credentials
 * never reach the stored form: seed them with `setupKeyAwareSecrets()`.
 */
const toStoredProfile = (profile: Record<string, unknown>): PersistedProviderProfile => {
	const classification = classifyProvider(profile.apiProvider)
	if (classification === "known-active" || classification === "known-hidden") {
		return createKnownPersistedProviderProfile(profile as ProviderSettingsWithId)
	}
	const payload = { ...profile }
	for (const key of SECRET_STATE_KEYS) delete payload[key]
	return {
		...(typeof profile.id === "string" ? { id: profile.id } : {}),
		provider: {
			providerId: typeof profile.apiProvider === "string" ? profile.apiProvider : "unknown",
			opaqueLegacyPayload: payload,
		},
	}
}

/** The secret store value for flat fixtures: the v2 envelope `{ schemaVersion: 2, data }`. */
const storedProfiles = (profiles: ProviderProfiles): string =>
	JSON.stringify({
		schemaVersion: 2,
		data: {
			...profiles,
			apiConfigs: Object.fromEntries(
				Object.entries(profiles.apiConfigs).map(([name, profile]) => [
					name,
					toStoredProfile(profile as Record<string, unknown>),
				]),
			),
		},
	})

// Mock VSCode ExtensionContext
// Export reads model info; spy on buildApiHandler to prove it builds no handler.
vi.mock("../../../api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../api")>()
	return { ...actual, buildApiHandler: vi.fn(actual.buildApiHandler) }
})

const mockSecrets = {
	get: vi.fn(),
	store: vi.fn(),
	delete: vi.fn(),
}

const unwrapStoredProfiles = (value: string): any => {
	const parsed = JSON.parse(value)
	if (parsed.schemaVersion !== 2) throw new Error("stored provider profiles are not the v2 envelope")
	const data = parsed.data
	return {
		...data,
		apiConfigs: Object.fromEntries(
			Object.entries(data.apiConfigs).map(([name, profile]: [string, any]) => [
				name,
				profile.provider
					? "config" in profile.provider
						? {
								id: profile.id,
								apiProvider: profile.provider.providerId,
								...profile.shared,
								...profile.provider.config,
							}
						: profile.provider.opaqueLegacyPayload
					: profile,
			]),
		),
	}
}

/**
 * Inspect mockSecrets.store calls for the `provider_profile_secrets_v2` write
 * and return the parsed secret map (profileId -> secret key -> value). Used to
 * assert that saved credentials land in the per-profile secret store and never
 * in the profile envelope.
 */
const unwrapStoredProfileSecrets = (): Record<string, Record<string, unknown>> => {
	// `updateProfileSecrets` merges into the existing map and re-stores the
	// whole map on every call, so the LAST v2-secrets write is the cumulative
	// state. Use the last matching call, not the first.
	const calls = mockSecrets.store.mock.calls.filter(
		(args) => args[0] === "roo_cline_config_provider_profile_secrets_v2",
	)
	const call = calls[calls.length - 1]
	if (!call) return {}
	try {
		const parsed = JSON.parse(call[1] as string)
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, Record<string, unknown>>)
			: {}
	} catch {
		return {}
	}
}

/**
 * Wire `mockSecrets` to a key-aware in-memory map so tests that assert on
 * secret round-tripping can verify `provider_profile_secrets_v2` is actually
 * consulted by `loadProfileSecrets()` (rather than the legacy config key
 * returning the same value for every key, which masked C1/C3 regressions).
 *
 * Pass the initial envelope JSON to seed the `api_config` key and, optionally,
 * the per-profile secrets (profileId -> secret key -> value). Returns the
 * underlying map so the test can assert on it directly.
 */
const setupKeyAwareSecrets = (
	initialApiConfigJson?: string,
	profileSecrets?: Record<string, Record<string, unknown>>,
): Record<string, string> => {
	const store: Record<string, string> = {}
	if (initialApiConfigJson !== undefined) {
		store["roo_cline_config_api_config"] = initialApiConfigJson
	}
	if (profileSecrets !== undefined) {
		store["roo_cline_config_provider_profile_secrets_v2"] = JSON.stringify(profileSecrets)
	}
	mockSecrets.get.mockImplementation(async (key: string) => (key in store ? store[key] : undefined))
	mockSecrets.store.mockImplementation(async (key: string, value: string) => {
		store[key] = value
	})
	mockSecrets.delete.mockImplementation(async (key: string) => {
		delete store[key]
	})
	return store
}

const mockGlobalState = {
	get: vi.fn(),
	update: vi.fn(),
}

const mockContext = {
	secrets: mockSecrets,
	globalState: mockGlobalState,
} as unknown as ExtensionContext

describe("ProviderSettingsManager", () => {
	let providerSettingsManager: ProviderSettingsManager

	beforeEach(() => {
		vi.clearAllMocks()
		// Reset all mock implementations to default successful behavior
		mockSecrets.get.mockResolvedValue(null)
		mockSecrets.store.mockResolvedValue(undefined)
		mockSecrets.delete.mockResolvedValue(undefined)
		mockGlobalState.get.mockReturnValue(undefined)
		mockGlobalState.update.mockResolvedValue(undefined)

		providerSettingsManager = new ProviderSettingsManager(mockContext)
	})

	describe("initialize", () => {
		it("should not write to storage when secrets.get returns null", async () => {
			// Mock readConfig to return null
			mockSecrets.get.mockResolvedValueOnce(null)

			await providerSettingsManager.initialize()

			// Should not write to storage because readConfig returns defaultConfig
			expect(mockSecrets.store).not.toHaveBeenCalled()
		})

		it("an empty store: writes nothing and lists the default profile", async () => {
			const store = setupKeyAwareSecrets()
			providerSettingsManager = new ProviderSettingsManager(mockContext)

			await providerSettingsManager.initialize()

			expect(mockSecrets.store).not.toHaveBeenCalled()
			expect(store).toEqual({})
			expect(await providerSettingsManager.listConfig()).toEqual([
				{ name: "default", id: expect.any(String), apiProvider: "anthropic" },
			])
			expect(mockSecrets.store).not.toHaveBeenCalled()
		})

		it("an unversioned stored value is rejected with a readable error and never overwritten", async () => {
			const unversioned = JSON.stringify({
				currentApiConfigName: "default",
				apiConfigs: { default: { id: "default", apiProvider: "anthropic", apiModelId: "claude-sonnet-4-5" } },
			})
			const store = setupKeyAwareSecrets(unversioned)
			providerSettingsManager = new ProviderSettingsManager(mockContext)

			await expect(providerSettingsManager.initialize()).rejects.toThrow("only version 2 is supported")
			await expect(providerSettingsManager.listConfig()).rejects.toThrow(
				/Failed to read provider profiles from secrets: .*only version 2 is supported/,
			)
			await expect(providerSettingsManager.getProfile({ name: "default" })).rejects.toThrow(
				"only version 2 is supported",
			)
			// A save or a mode binding must not replace the unreadable record either.
			await expect(providerSettingsManager.saveConfig("other", { apiProvider: "anthropic" })).rejects.toThrow(
				"only version 2 is supported",
			)
			await expect(providerSettingsManager.setModeConfig("code", "default")).rejects.toThrow(
				"only version 2 is supported",
			)

			expect(mockSecrets.store).not.toHaveBeenCalled()
			expect(mockSecrets.delete).not.toHaveBeenCalled()
			expect(store["roo_cline_config_api_config"]).toBe(unversioned)
		})

		it("a stored value with another schema version is rejected and not overwritten", async () => {
			const future = JSON.stringify({ schemaVersion: 3, data: { currentApiConfigName: "x", apiConfigs: {} } })
			const store = setupKeyAwareSecrets(future)
			providerSettingsManager = new ProviderSettingsManager(mockContext)

			await expect(providerSettingsManager.initialize()).rejects.toThrow(
				"Provider profiles have schema version 3, only version 2 is supported",
			)
			expect(mockSecrets.store).not.toHaveBeenCalled()
			expect(store["roo_cline_config_api_config"]).toBe(future)
		})

		// Envelopes written before the migrations were removed still carry a `migrations` record. The data
		// schema passes unknown keys through, so such a store loads as it is and nothing is rewritten.
		it("loads a stored envelope that still carries an old migrations record without rewriting it", async () => {
			mockGlobalState.get.mockReturnValue(42)
			const stored = {
				schemaVersion: 2,
				data: {
					currentApiConfigName: "default",
					apiConfigs: {
						default: { id: "default", provider: { providerId: "anthropic", config: {} } },
						compat: {
							id: "compat",
							provider: {
								providerId: "openai",
								config: {
									openAiBaseUrl: "https://llm.example.com/v1",
									openAiHostHeader: "llm.internal",
								},
							},
						},
					},
					modeApiConfigs: { code: "default" },
					migrations: {
						rateLimitSecondsMigrated: false,
						openAiHeadersMigrated: false,
						consecutiveMistakeLimitMigrated: false,
						todoListEnabledMigrated: false,
						claudeCodeLegacySettingsMigrated: false,
					},
				},
			}
			mockSecrets.get.mockResolvedValue(JSON.stringify(stored))

			await providerSettingsManager.initialize()

			expect(mockSecrets.store).not.toHaveBeenCalled()
			expect(await providerSettingsManager.listConfig()).toHaveLength(2)
			const compat = await providerSettingsManager.getProfile({ name: "compat" })
			expect(compat.openAiHostHeader).toBe("llm.internal")
			expect(compat.openAiHeaders).toBeUndefined()
			expect(compat.rateLimitSeconds).toBeUndefined()
			expect(compat.todoListEnabled).toBeUndefined()
		})

		it("should throw error if secrets storage fails", async () => {
			mockSecrets.get.mockRejectedValue(new Error("Storage failed"))

			await expect(providerSettingsManager.initialize()).rejects.toThrow(
				"Failed to initialize config: Error: Failed to read provider profiles from secrets: Error: Storage failed",
			)
		})
	})

	describe("ListConfig", () => {
		it("should list all available configs", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: {
						id: "default",
					},
					test: {
						apiProvider: "anthropic",
						id: "test-id",
					},
				},
				modeApiConfigs: {
					code: "default",
					architect: "default",
					ask: "default",
				},
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const configs = await providerSettingsManager.listConfig()
			expect(configs).toEqual([
				{ name: "default", id: "default", apiProvider: undefined },
				{ name: "test", id: "test-id", apiProvider: "anthropic" },
			])
		})

		it("should handle empty config file", async () => {
			const emptyConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {},
				modeApiConfigs: {
					code: "default",
					architect: "default",
					ask: "default",
				},
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(emptyConfig))

			const configs = await providerSettingsManager.listConfig()
			expect(configs).toEqual([])
		})

		it("should throw error if reading from secrets fails", async () => {
			mockSecrets.get.mockRejectedValue(new Error("Read failed"))

			await expect(providerSettingsManager.listConfig()).rejects.toThrow(
				"Failed to list configs: Error: Failed to read provider profiles from secrets: Error: Read failed",
			)
		})
	})

	describe("SaveConfig", () => {
		it("should save new config", async () => {
			mockSecrets.get.mockResolvedValue(
				storedProfiles({
					currentApiConfigName: "default",
					apiConfigs: {
						default: {},
					},
					modeApiConfigs: {
						code: "default",
						architect: "default",
						ask: "default",
					},
				}),
			)

			const newConfig: ProviderSettings = {
				apiProvider: "vertex",
				apiModelId: "gemini-2.5-flash-preview-05-20",
				vertexKeyFile: "test-key-file",
			}

			await providerSettingsManager.saveConfig("test", newConfig)

			// Get the actual stored config to check the generated ID
			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])
			const testConfigId = storedConfig.apiConfigs.test.id

			const expectedConfig = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: {},
					test: {
						...newConfig,
						id: testConfigId,
					},
				},
				modeApiConfigs: {
					code: "default",
					architect: "default",
					ask: "default",
				},
			}

			expect(mockSecrets.store.mock.calls[0][0]).toEqual("roo_cline_config_api_config")
			expect(storedConfig).toEqual(expectedConfig)
		})

		it("should only save provider relevant settings", async () => {
			mockSecrets.get.mockResolvedValue(
				storedProfiles({
					currentApiConfigName: "default",
					apiConfigs: {
						default: {},
					},
					modeApiConfigs: {
						code: "default",
						architect: "default",
						ask: "default",
					},
				}),
			)

			const newConfig: ProviderSettings = {
				apiProvider: "anthropic",
				apiKey: "test-key",
			}
			const newConfigWithExtra: ProviderSettings = {
				...newConfig,
				openRouterApiKey: "another-key",
			}

			await providerSettingsManager.saveConfig("test", newConfigWithExtra)

			// Get the actual stored config to check the generated ID
			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])
			const testConfigId = storedConfig.apiConfigs.test.id

			const expectedConfig = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: {},
					test: {
						apiProvider: "anthropic",
						id: testConfigId,
					},
				},
				modeApiConfigs: {
					code: "default",
					architect: "default",
					ask: "default",
				},
			}

			expect(mockSecrets.store.mock.calls[0][0]).toEqual("roo_cline_config_api_config")
			expect(storedConfig).toEqual(expectedConfig)
		})

		it("should update existing config", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					test: {
						apiProvider: "anthropic",
						apiKey: "old-key",
						id: "test-id",
					},
				},
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const updatedConfig: ProviderSettings = {
				apiProvider: "anthropic",
				apiKey: "new-key",
			}

			await providerSettingsManager.saveConfig("test", updatedConfig)

			const expectedConfig = {
				currentApiConfigName: "default",
				apiConfigs: {
					test: {
						apiProvider: "anthropic",
						id: "test-id",
					},
				},
			}

			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])
			expect(mockSecrets.store.mock.calls[0][0]).toEqual("roo_cline_config_api_config")
			expect(storedConfig).toEqual(expectedConfig)
		})

		it("should throw error if secrets storage fails", async () => {
			mockSecrets.get.mockResolvedValue(
				storedProfiles({
					currentApiConfigName: "default",
					apiConfigs: { default: {} },
				}),
			)
			mockSecrets.store.mockRejectedValue(new Error("Storage failed"))

			await expect(providerSettingsManager.saveConfig("test", {})).rejects.toThrow(
				"Failed to save config: Error: Failed to write provider profiles to secrets: Error: Storage failed",
			)
		})

		it("should preserve full fields including legacy provider-specific keys when saving retired provider profiles", async () => {
			mockSecrets.get.mockResolvedValue(
				storedProfiles({
					currentApiConfigName: "default",
					apiConfigs: {
						default: {},
					},
					modeApiConfigs: {
						code: "default",
						architect: "default",
						ask: "default",
					},
				}),
			)

			// Include a legacy provider-specific field (groqApiKey) that is no
			// longer in the schema: passthrough() must keep it.
			const retiredConfig = {
				apiProvider: "groq",
				apiKey: "legacy-key",
				apiModelId: "legacy-model",
				openAiBaseUrl: "https://legacy.example/v1",
				openAiApiKey: "legacy-openai-key",
				modelMaxTokens: 4096,
				groqApiKey: "legacy-groq-specific-key",
			} as ProviderSettings

			await providerSettingsManager.saveConfig("retired", retiredConfig)

			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs.retired.apiProvider).toBe("groq")
			expect(storedConfig.apiConfigs.retired.apiKey).toBeUndefined()
			expect(storedConfig.apiConfigs.retired.apiModelId).toBe("legacy-model")
			expect(storedConfig.apiConfigs.retired.openAiBaseUrl).toBe("https://legacy.example/v1")
			expect(storedConfig.apiConfigs.retired.openAiApiKey).toBeUndefined()
			expect(storedConfig.apiConfigs.retired.modelMaxTokens).toBe(4096)
			// Verify legacy provider-specific field is preserved via passthrough
			expect(storedConfig.apiConfigs.retired.groqApiKey).toBe("legacy-groq-specific-key")
			expect(mockSecrets.store.mock.calls[0][1]).toContain('"id"')
		})
	})

	describe("vertex JSON credentials", () => {
		const VERTEX_JSON = JSON.stringify({ type: "service_account", client_email: "sa@p.iam.gserviceaccount.com" })

		it("keeps vertexJsonCredentials across save and reload, outside the persisted envelope", async () => {
			const store = setupKeyAwareSecrets()
			providerSettingsManager = new ProviderSettingsManager(mockContext)
			await providerSettingsManager.initialize()

			const id = await providerSettingsManager.saveConfig("vertex", {
				apiProvider: "vertex",
				vertexJsonCredentials: VERTEX_JSON,
				vertexProjectId: "p",
			})

			// The profile envelope stays free of the credential ...
			expect(store["roo_cline_config_api_config"]).not.toContain("service_account")
			// ... because it lives in the per-profile secret store.
			expect(unwrapStoredProfileSecrets()[id]?.vertexJsonCredentials).toBe(VERTEX_JSON)

			// A fresh manager (next VS Code start) reads it back.
			const reloaded = await new ProviderSettingsManager(mockContext).getProfile({ name: "vertex" })
			expect(reloaded.vertexJsonCredentials).toBe(VERTEX_JSON)
			expect(reloaded.vertexProjectId).toBe("p")
		})
	})

	describe("DeleteConfig", () => {
		it("should delete existing config", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: {
						id: "default",
					},
					test: {
						apiProvider: "anthropic",
						id: "test-id",
					},
				},
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			await providerSettingsManager.deleteConfig("test")

			// Get the stored config to check the ID
			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.currentApiConfigName).toBe("default")
			expect(Object.keys(storedConfig.apiConfigs)).toEqual(["default"])
			expect(storedConfig.apiConfigs.default.id).toBeTruthy()
		})

		it("should throw error when trying to delete non-existent config", async () => {
			mockSecrets.get.mockResolvedValue(
				storedProfiles({
					currentApiConfigName: "default",
					apiConfigs: { default: {} },
				}),
			)

			await expect(providerSettingsManager.deleteConfig("nonexistent")).rejects.toThrow(
				"Config 'nonexistent' not found",
			)
		})

		it("should throw error when trying to delete last remaining config", async () => {
			mockSecrets.get.mockResolvedValue(
				storedProfiles({
					currentApiConfigName: "default",
					apiConfigs: {
						default: {
							id: "default",
						},
					},
				}),
			)

			await expect(providerSettingsManager.deleteConfig("default")).rejects.toThrow(
				"Failed to delete config: Error: Cannot delete the last remaining configuration",
			)
		})
	})

	describe("LoadConfig", () => {
		it("should load config and update current config name", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					test: {
						apiProvider: "anthropic",
						id: "test-id",
					},
				},
			}

			// Key-aware in-memory secret store so `loadProfileSecrets()` reads the
			// credential from `provider_profile_secrets_v2`, not from the envelope.
			setupKeyAwareSecrets(storedProfiles(existingConfig), { "test-id": { apiKey: "test-key" } })
			// Re-instantiate so the constructor's auto-initialize runs against
			// the key-aware store instead of the `beforeEach` default (null).
			providerSettingsManager = new ProviderSettingsManager(mockContext)
			await providerSettingsManager.initialize()
			expect(mockSecrets.store).not.toHaveBeenCalled()

			const { name, ...providerSettings } = await providerSettingsManager.activateProfile({ name: "test" })

			expect(name).toBe("test")
			// The secret must round-trip back through getProfile/activateProfile.
			expect(providerSettings.apiKey).toBe("test-key")
			expect(providerSettings.apiProvider).toBe("anthropic")
			expect(providerSettings.id).toBe("test-id")

			// Get the stored config to check the structure.
			const calls = mockSecrets.store.mock.calls
			const storedConfig = unwrapStoredProfiles(calls[calls.length - 1][1])
			expect(storedConfig.currentApiConfigName).toBe("test")

			expect(storedConfig.apiConfigs.test).toEqual({
				id: "test-id",
				apiProvider: "anthropic",
			})
			// Plaintext secret must NOT appear in the on-disk v2 envelope.
			expect(JSON.stringify(storedConfig)).not.toContain("test-key")
		})

		it("should throw error when config does not exist", async () => {
			mockSecrets.get.mockResolvedValue(
				storedProfiles({
					currentApiConfigName: "default",
					apiConfigs: { default: { id: "default" } },
				}),
			)

			await expect(providerSettingsManager.activateProfile({ name: "nonexistent" })).rejects.toThrow(
				"Config with name 'nonexistent' not found",
			)
		})

		it("should throw error if secrets storage fails", async () => {
			mockSecrets.get.mockResolvedValue(
				storedProfiles({
					currentApiConfigName: "default",
					apiConfigs: { test: { apiProvider: "anthropic", id: "test-id" } },
				}),
			)
			mockSecrets.store.mockRejectedValue(new Error("Storage failed"))

			await expect(providerSettingsManager.activateProfile({ name: "test" })).rejects.toThrow(
				"Failed to activate profile: Failed to write provider profiles to secrets: Error: Storage failed",
			)
		})

		it("keeps an unknown-provider profile lossless when the store is rewritten", async () => {
			const configWithUnknownProvider: ProviderProfiles = {
				currentApiConfigName: "valid",
				apiConfigs: {
					valid: {
						apiProvider: "anthropic",
						apiModelId: "claude-3-opus-20240229",
						id: "valid-id",
					},
					unknownProvider: {
						// Provider value that is neither active nor retired.
						id: "removed-id",
						apiProvider: "invalid-removed-provider" as ProviderSettings["apiProvider"],
						apiModelId: "some-model",
					},
				},
			}

			// Key-aware store so the secret round-trip is observable.
			setupKeyAwareSecrets(storedProfiles(configWithUnknownProvider), {
				"valid-id": { apiKey: "valid-key" },
				"removed-id": { apiKey: "some-key" },
			})
			// Re-instantiate so the constructor's auto-initialize runs against
			// the key-aware store instead of the `beforeEach` default (null).
			providerSettingsManager = new ProviderSettingsManager(mockContext)
			await providerSettingsManager.initialize()
			expect(mockSecrets.store).not.toHaveBeenCalled()

			// Any write (here: activating the known profile) re-stores every profile.
			await providerSettingsManager.activateProfile({ name: "valid" })

			const storeCalls = mockSecrets.store.mock.calls.filter((call) => call[0] === "roo_cline_config_api_config")
			expect(storeCalls.length).toBeGreaterThan(0)
			const finalStoredConfigJson = storeCalls[storeCalls.length - 1][1]

			const storedConfig = unwrapStoredProfiles(finalStoredConfigJson)
			expect(storedConfig.apiConfigs.valid.apiProvider).toBe("anthropic")

			// Unknown-provider data must remain lossless for a newer client.
			expect(storedConfig.apiConfigs.unknownProvider).toEqual({
				id: "removed-id",
				apiProvider: "invalid-removed-provider",
				apiModelId: "some-model",
			})

			// Credentials stay in `provider_profile_secrets_v2`, never in the envelope.
			expect(finalStoredConfigJson).not.toContain("some-key")
			expect(finalStoredConfigJson).not.toContain("valid-key")
			const unknown = await providerSettingsManager.getProfile({ name: "unknownProvider" })
			expect(unknown.apiKey).toBe("some-key")
			expect(unknown.apiProvider).toBe("invalid-removed-provider")
		})

		it("reads a retired-provider profile with its legacy provider-specific keys and its stored secret", async () => {
			const configWithRetiredProvider: ProviderProfiles = {
				currentApiConfigName: "retiredProvider",
				apiConfigs: {
					retiredProvider: {
						id: "retired-id",
						apiProvider: "groq" as ProviderSettings["apiProvider"],
						apiModelId: "legacy-model",
						openAiBaseUrl: "https://legacy.example/v1",
						modelMaxTokens: 1024,
						// Legacy provider-specific field no longer in schema
						groqApiKey: "legacy-groq-key",
					} as ProviderSettingsWithId,
				},
			}

			// Key-aware store so the opaque profile's secret round-trips
			// through `provider_profile_secrets_v2`.
			setupKeyAwareSecrets(storedProfiles(configWithRetiredProvider), {
				"retired-id": { apiKey: "legacy-key" },
			})
			// Re-instantiate so the constructor's auto-initialize runs against
			// the key-aware store instead of the `beforeEach` default (null).
			providerSettingsManager = new ProviderSettingsManager(mockContext)
			await providerSettingsManager.initialize()
			expect(mockSecrets.store).not.toHaveBeenCalled()

			const { name, ...reloaded } = await providerSettingsManager.getProfile({ name: "retiredProvider" })
			expect(name).toBe("retiredProvider")
			expect(reloaded.apiProvider).toBe("groq")
			expect(reloaded.apiKey).toBe("legacy-key")
			expect(reloaded.apiModelId).toBe("legacy-model")
			expect(reloaded.openAiBaseUrl).toBe("https://legacy.example/v1")
			expect(reloaded.modelMaxTokens).toBe(1024)
			// `groqApiKey` is not a SECRET_STATE_KEY, so it stays in the opaque payload.
			expect((reloaded as Record<string, unknown>).groqApiKey).toBe("legacy-groq-key")
			// A retired provider cannot be activated.
			await expect(providerSettingsManager.activateProfile({ name: "retiredProvider" })).rejects.toThrow(
				"Provider 'groq' is unavailable and cannot be activated.",
			)
		})

		it("rejects a stored envelope with a non-object profile and writes nothing", async () => {
			const envelope = JSON.parse(
				storedProfiles({
					currentApiConfigName: "valid",
					apiConfigs: {
						valid: { apiProvider: "anthropic", apiModelId: "claude-3-opus-20240229", id: "valid-id" },
					},
				}),
			)
			envelope.data.apiConfigs.anotherInvalid = "not an object"
			mockSecrets.get.mockResolvedValue(JSON.stringify(envelope))

			// The schema error is reported through telemetry, which this spec does not
			// initialize, so only the outer message is pinned here.
			await expect(providerSettingsManager.initialize()).rejects.toThrow("Failed to initialize config")
			expect(mockSecrets.store).not.toHaveBeenCalled()
		})
	})

	describe("Export", () => {
		it("should preserve retired provider profiles with full fields", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "retired",
				apiConfigs: {
					retired: {
						id: "retired-id",
						apiProvider: "groq",
						apiModelId: "legacy-model",
						openAiBaseUrl: "https://legacy.example/v1",
						modelMaxTokens: 4096,
						modelMaxThinkingTokens: 2048,
					},
				},
			}

			setupKeyAwareSecrets(storedProfiles(existingConfig), { "retired-id": { apiKey: "legacy-key" } })

			const exported = await providerSettingsManager.export()
			expect(exported.schemaVersion).toBe(2)
			const retired = exported.data.apiConfigs.retired
			expect(retired && "provider" in retired ? retired.provider : undefined).toMatchObject({
				providerId: "groq",
				opaqueLegacyPayload: expect.objectContaining({
					apiProvider: "groq",
					apiModelId: "legacy-model",
					openAiBaseUrl: "https://legacy.example/v1",
					modelMaxTokens: 4096,
					modelMaxThinkingTokens: 2048,
				}),
			})
			// The stored credential of an opaque profile never reaches the export file.
			const opaquePayload =
				retired && "provider" in retired && "opaqueLegacyPayload" in retired.provider
					? (retired.provider.opaqueLegacyPayload as Record<string, unknown>)
					: undefined
			expect(opaquePayload?.apiKey).toBeUndefined()
			expect(JSON.stringify(exported)).not.toContain("legacy-key")
		})

		it("should preserve modelMaxTokens for models that support a configurable max output (e.g. GLM)", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "glm",
				apiConfigs: {
					glm: {
						id: "glm-id",
						apiProvider: "zai",
						apiModelId: "glm-5.1",
						modelMaxTokens: 8192,
						modelMaxThinkingTokens: 2048,
					},
				},
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const exported = await providerSettingsManager.export()

			// GLM exposes a configurable max output (supportsMaxTokens) but no reasoning budget,
			// so modelMaxTokens must survive the export while modelMaxThinkingTokens is dropped.
			const glm = exported.data.apiConfigs.glm
			expect(glm && "shared" in glm ? glm.shared?.modelMaxTokens : undefined).toBe(8192)
			expect(glm && "shared" in glm ? glm.shared?.modelMaxThinkingTokens : undefined).toBeUndefined()
		})

		// API-6: building a handler to read model info has side effects (the
		// OpenRouter handler fetches its model list, VS Code LM subscribes to
		// configuration changes); the model is resolved from the settings.
		it("resolves model info without building a provider handler", async () => {
			const { buildApiHandler } = await import("../../../api")
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "glm",
				apiConfigs: {
					glm: { id: "glm-id", apiProvider: "zai", apiModelId: "glm-5.1", modelMaxTokens: 8192 },
					router: { id: "router-id", apiProvider: "openrouter", openRouterModelId: "a/b" },
				},
			}
			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))
			vi.mocked(buildApiHandler).mockClear()

			const exported = await providerSettingsManager.export()

			expect(buildApiHandler).not.toHaveBeenCalled()
			const glm = exported.data.apiConfigs.glm
			expect(glm && "shared" in glm ? glm.shared?.modelMaxTokens : undefined).toBe(8192)
		})

		it("should strip both token fields for models that support neither reasoning budgets nor a configurable max", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "bedrock",
				apiConfigs: {
					bedrock: {
						id: "bedrock-id",
						apiProvider: "bedrock",
						apiModelId: "amazon.nova-pro-v1:0",
						modelMaxTokens: 8192,
						modelMaxThinkingTokens: 2048,
					},
				},
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const exported = await providerSettingsManager.export()
			const bedrock = exported.data.apiConfigs.bedrock
			expect(bedrock && "shared" in bedrock).toBe(true)
			expect(bedrock && "shared" in bedrock ? bedrock.shared?.modelMaxTokens : undefined).toBeUndefined()
			expect(bedrock && "shared" in bedrock ? bedrock.shared?.modelMaxThinkingTokens : undefined).toBeUndefined()
		})
	})

	describe("Import", () => {
		it("stores the profiles as the v2 envelope and does not seed inline credentials into the secret store", async () => {
			setupKeyAwareSecrets(
				storedProfiles({
					currentApiConfigName: "local",
					apiConfigs: { local: { id: "local-id", apiProvider: "anthropic" } },
				}),
				{ "local-id": { apiKey: "stored-key" } },
			)

			await providerSettingsManager.import({
				currentApiConfigName: "imported",
				apiConfigs: {
					local: { id: "local-id", apiProvider: "anthropic", apiModelId: "claude-3-opus-20240229" },
					imported: { id: "imported-id", apiProvider: "openai", openAiApiKey: "inline-key" },
				},
				modeApiConfigs: { code: "imported-id" },
			})

			// Only the profile envelope is written; the per-profile secrets are untouched.
			expect(mockSecrets.store.mock.calls.map((call) => call[0])).toEqual(["roo_cline_config_api_config"])
			const storedJson = mockSecrets.store.mock.calls[0][1]
			expect(storedJson).not.toContain("inline-key")
			const stored = unwrapStoredProfiles(storedJson)
			expect(stored.currentApiConfigName).toBe("imported")
			expect(stored.modeApiConfigs).toEqual({ code: "imported-id" })

			// The secret stored for an id stays attached to that id; an inline one is dropped.
			expect((await providerSettingsManager.getProfile({ name: "local" })).apiKey).toBe("stored-key")
			expect((await providerSettingsManager.getProfile({ name: "imported" })).openAiApiKey).toBeUndefined()
		})

		it("imports its own export back without losing a profile", async () => {
			setupKeyAwareSecrets(
				storedProfiles({
					currentApiConfigName: "glm",
					apiConfigs: {
						glm: { id: "glm-id", apiProvider: "zai", apiModelId: "glm-5.1" },
						compat: {
							id: "compat-id",
							apiProvider: "openai",
							openAiBaseUrl: "https://llm.example.com/v1",
							openAiModelId: "local-model",
						},
					},
				}),
			)
			const before = await providerSettingsManager.listConfig()

			const exported = await providerSettingsManager.export()
			await providerSettingsManager.import(exported.data)

			expect(await providerSettingsManager.listConfig()).toEqual(before)
			const compat = await providerSettingsManager.getProfile({ name: "compat" })
			expect(compat.apiProvider).toBe("openai")
			expect(compat.openAiModelId).toBe("local-model")
		})
	})

	describe("ResetAllConfigs", () => {
		it("should delete all stored configs", async () => {
			// Setup initial config
			mockSecrets.get.mockResolvedValue(
				storedProfiles({
					currentApiConfigName: "test",
					apiConfigs: { test: { apiProvider: "anthropic", id: "test-id" } },
				}),
			)

			await providerSettingsManager.resetAllConfigs()

			// Should have called delete with the correct config key
			expect(mockSecrets.delete).toHaveBeenCalledWith("roo_cline_config_api_config")
		})
	})

	describe("HasConfig", () => {
		it("should return true for existing config", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: { default: { id: "default" }, test: { apiProvider: "anthropic", id: "test-id" } },
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const hasConfig = await providerSettingsManager.hasConfig("test")
			expect(hasConfig).toBe(true)
		})

		it("should return false for non-existent config", async () => {
			mockSecrets.get.mockResolvedValue(
				storedProfiles({ currentApiConfigName: "default", apiConfigs: { default: {} } }),
			)

			const hasConfig = await providerSettingsManager.hasConfig("nonexistent")
			expect(hasConfig).toBe(false)
		})

		it("should throw error if secrets storage fails", async () => {
			mockSecrets.get.mockRejectedValue(new Error("Storage failed"))

			await expect(providerSettingsManager.hasConfig("test")).rejects.toThrow(
				"Failed to check config existence: Error: Failed to read provider profiles from secrets: Error: Storage failed",
			)
		})
	})

	describe("setModeConfigs", () => {
		it("should assign the given config id to every listed mode in a single store call", async () => {
			mockSecrets.get.mockResolvedValue(
				storedProfiles({
					currentApiConfigName: "default",
					apiConfigs: {
						default: { id: "default" },
						local: { apiProvider: "ollama", id: "local-id" },
					},
					modeApiConfigs: {
						code: "default",
						architect: "default",
						ask: "default",
					},
				}),
			)

			await providerSettingsManager.setModeConfigs(["code", "architect", "ask"], "local-id")

			// A bulk assignment must persist with exactly one store round-trip.
			expect(mockSecrets.store).toHaveBeenCalledTimes(1)

			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.modeApiConfigs).toEqual({
				code: "local-id",
				architect: "local-id",
				ask: "local-id",
			})
		})

		it("should preserve assignments for modes not included in the list", async () => {
			mockSecrets.get.mockResolvedValue(
				storedProfiles({
					currentApiConfigName: "default",
					apiConfigs: {
						default: { id: "default" },
						local: { apiProvider: "ollama", id: "local-id" },
					},
					modeApiConfigs: {
						code: "default",
						architect: "default",
						ask: "default",
					},
				}),
			)

			await providerSettingsManager.setModeConfigs(["code"], "local-id")

			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.modeApiConfigs).toEqual({
				code: "local-id",
				architect: "default",
				ask: "default",
			})
		})

		it("should create the modeApiConfigs map when it is absent", async () => {
			mockSecrets.get.mockResolvedValue(
				storedProfiles({
					currentApiConfigName: "default",
					apiConfigs: { default: { id: "default" }, local: { apiProvider: "ollama", id: "local-id" } },
				}),
			)

			await providerSettingsManager.setModeConfigs(["code", "ask"], "local-id")

			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.modeApiConfigs).toMatchObject({
				code: "local-id",
				ask: "local-id",
			})
		})

		it("should not write when given an empty mode list", async () => {
			mockSecrets.get.mockResolvedValue(
				storedProfiles({
					currentApiConfigName: "default",
					apiConfigs: { default: { id: "default" } },
					modeApiConfigs: { code: "default" },
				}),
			)

			await providerSettingsManager.setModeConfigs([], "default")

			expect(mockSecrets.store).not.toHaveBeenCalled()
		})
	})

	describe("syncCloudProfiles", () => {
		it("should add new cloud profiles without secret keys", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: { id: "default-id" },
				},
				cloudProfileIds: [],
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const cloudProfiles = {
				"cloud-profile": {
					id: "cloud-id-1",
					apiProvider: "anthropic" as const,
					apiKey: "secret-key", // This should be removed
					apiModelId: "claude-3-opus-20240229",
				},
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles)

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("")

			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs["cloud-profile"]).toEqual({
				id: "cloud-id-1",
				apiProvider: "anthropic",
				apiModelId: "claude-3-opus-20240229",
				// apiKey should be removed
			})
			expect(storedConfig.cloudProfileIds).toEqual(["cloud-id-1"])
		})

		it("should update existing cloud profiles by ID, preserving secret keys", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: { id: "default-id" },
					"existing-cloud": {
						id: "cloud-id-1",
						apiProvider: "anthropic" as const,
						apiKey: "existing-secret",
						apiModelId: "claude-3-haiku-20240307",
					},
				},
				cloudProfileIds: ["cloud-id-1"],
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const cloudProfiles = {
				"updated-name": {
					id: "cloud-id-1",
					apiProvider: "anthropic" as const,
					apiKey: "new-secret", // Should be ignored
					apiModelId: "claude-3-opus-20240229",
				},
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles)

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("")

			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs["updated-name"]).toEqual({
				id: "cloud-id-1",
				apiProvider: "anthropic",
				apiModelId: "claude-3-opus-20240229", // Updated
			})
			expect(JSON.stringify(storedConfig)).not.toContain("existing-secret")
			expect(storedConfig.apiConfigs["existing-cloud"]).toBeUndefined()
			expect(storedConfig.cloudProfileIds).toEqual(["cloud-id-1"])
		})

		it("should delete cloud profiles not in the new cloud profiles", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: { id: "default-id" },
					"cloud-profile-1": { id: "cloud-id-1", apiProvider: "anthropic" as const },
					"cloud-profile-2": { id: "cloud-id-2", apiProvider: "openai" as const },
				},
				cloudProfileIds: ["cloud-id-1", "cloud-id-2"],
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const cloudProfiles = {
				"cloud-profile-1": {
					id: "cloud-id-1",
					apiProvider: "anthropic" as const,
				},
				// cloud-profile-2 is missing, should be deleted
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles)

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("")

			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs["cloud-profile-1"]).toBeDefined()
			expect(storedConfig.apiConfigs["cloud-profile-2"]).toBeUndefined()
			expect(storedConfig.cloudProfileIds).toEqual(["cloud-id-1"])
		})

		it("should rename existing non-cloud profile when cloud profile has same name", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: { id: "default-id" },
					"conflict-name": { id: "local-id", apiProvider: "openai" as const },
				},
				cloudProfileIds: [],
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const cloudProfiles = {
				"conflict-name": {
					id: "cloud-id-1",
					apiProvider: "anthropic" as const,
				},
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles)

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("")

			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs["conflict-name"]).toEqual({
				id: "cloud-id-1",
				apiProvider: "anthropic",
			})
			expect(storedConfig.apiConfigs["conflict-name_local"]).toEqual({
				id: "local-id",
				apiProvider: "openai",
			})
			expect(storedConfig.cloudProfileIds).toEqual(["cloud-id-1"])
		})

		it("should handle multiple naming conflicts with incremental suffixes", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: { id: "default-id" },
					"conflict-name": { id: "local-id-1", apiProvider: "openai" as const },
					"conflict-name_local": { id: "local-id-2", apiProvider: "vertex" as const },
				},
				cloudProfileIds: [],
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const cloudProfiles = {
				"conflict-name": {
					id: "cloud-id-1",
					apiProvider: "anthropic" as const,
				},
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles)

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("")

			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs["conflict-name"]).toEqual({
				id: "cloud-id-1",
				apiProvider: "anthropic",
			})
			expect(storedConfig.apiConfigs["conflict-name_1"]).toEqual({
				id: "local-id-1",
				apiProvider: "openai",
			})
			expect(storedConfig.apiConfigs["conflict-name_local"]).toEqual({
				id: "local-id-2",
				apiProvider: "vertex",
			})
		})

		it("should handle empty cloud profiles by deleting all cloud-managed profiles", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: { id: "default-id" },
					"cloud-profile-1": { id: "cloud-id-1", apiProvider: "anthropic" as const },
					"cloud-profile-2": { id: "cloud-id-2", apiProvider: "openai" as const },
				},
				cloudProfileIds: ["cloud-id-1", "cloud-id-2"],
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const cloudProfiles = {}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles)

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("")

			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs["cloud-profile-1"]).toBeUndefined()
			expect(storedConfig.apiConfigs["cloud-profile-2"]).toBeUndefined()
			expect(storedConfig.apiConfigs["default"]).toBeDefined()
			expect(storedConfig.cloudProfileIds).toEqual([])
		})

		it("should skip cloud profiles without IDs", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: { id: "default-id" },
				},
				cloudProfileIds: [],
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const cloudProfiles = {
				"valid-profile": {
					id: "cloud-id-1",
					apiProvider: "anthropic" as const,
				},
				"invalid-profile": {
					// Missing id
					apiProvider: "openai" as const,
				},
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles)

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("")

			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs["valid-profile"]).toBeDefined()
			expect(storedConfig.apiConfigs["invalid-profile"]).toBeUndefined()
			expect(storedConfig.cloudProfileIds).toEqual(["cloud-id-1"])
		})

		it("should handle complex sync scenario with multiple operations", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: { id: "default-id" },
					"keep-cloud": { id: "cloud-id-1", apiProvider: "anthropic" as const, apiKey: "secret1" },
					"delete-cloud": { id: "cloud-id-2", apiProvider: "openai" as const },
					"rename-me": { id: "local-id", apiProvider: "vertex" as const },
				},
				cloudProfileIds: ["cloud-id-1", "cloud-id-2"],
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const cloudProfiles = {
				"updated-keep": {
					id: "cloud-id-1",
					apiProvider: "anthropic" as const,
					apiKey: "new-secret", // Should be ignored
					apiModelId: "claude-3-opus-20240229",
				},
				"rename-me": {
					id: "cloud-id-3",
					apiProvider: "openai" as const,
				},
				// delete-cloud is missing (should be deleted)
				// new profile
				"new-cloud": {
					id: "cloud-id-4",
					apiProvider: "vertex" as const,
				},
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles)

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("")

			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])

			// Check deletions
			expect(storedConfig.apiConfigs["delete-cloud"]).toBeUndefined()
			expect(storedConfig.apiConfigs["keep-cloud"]).toBeUndefined()

			// Check updates
			expect(storedConfig.apiConfigs["updated-keep"]).toEqual({
				id: "cloud-id-1",
				apiProvider: "anthropic",
				apiModelId: "claude-3-opus-20240229",
			})
			expect(JSON.stringify(storedConfig)).not.toContain("secret1")

			// Check renames
			expect(storedConfig.apiConfigs["rename-me_local"]).toEqual({
				id: "local-id",
				apiProvider: "vertex",
			})
			expect(storedConfig.apiConfigs["rename-me"]).toEqual({
				id: "cloud-id-3",
				apiProvider: "openai",
			})

			// Check new additions
			expect(storedConfig.apiConfigs["new-cloud"]).toEqual({
				id: "cloud-id-4",
				apiProvider: "vertex",
			})

			expect(storedConfig.cloudProfileIds).toEqual(["cloud-id-1", "cloud-id-3", "cloud-id-4"])
		})

		it("should throw error if secrets storage fails", async () => {
			mockSecrets.get.mockResolvedValue(
				storedProfiles({
					currentApiConfigName: "default",
					apiConfigs: { default: { id: "default-id" } },
					cloudProfileIds: [],
				}),
			)
			mockSecrets.store.mockRejectedValue(new Error("Storage failed"))

			await expect(providerSettingsManager.syncCloudProfiles({})).rejects.toThrow(
				"Failed to sync cloud profiles: Error: Failed to write provider profiles to secrets: Error: Storage failed",
			)
		})

		it("should track active profile changes when active profile is updated", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "active-profile",
				apiConfigs: {
					"active-profile": {
						id: "active-id",
						apiProvider: "anthropic" as const,
						apiKey: "old-key",
					},
				},
				cloudProfileIds: ["active-id"],
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const cloudProfiles = {
				"active-profile": {
					id: "active-id",
					apiProvider: "anthropic" as const,
					apiModelId: "claude-3-opus-20240229", // Updated setting
				},
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles, "active-profile")

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(true)
			expect(result.activeProfileId).toBe("active-id")
		})

		it("should track active profile changes when active profile is deleted", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "active-profile",
				apiConfigs: {
					"active-profile": { id: "active-id", apiProvider: "anthropic" as const },
					"backup-profile": { id: "backup-id", apiProvider: "openai" as const },
				},
				cloudProfileIds: ["active-id"],
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const cloudProfiles = {} // Active profile deleted

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles, "active-profile")

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(true)
			expect(result.activeProfileId).toBe("backup-id") // Should switch to first available
		})

		it("should create default profile when all profiles are deleted", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "only-profile",
				apiConfigs: {
					"only-profile": { id: "only-id", apiProvider: "anthropic" as const },
				},
				cloudProfileIds: ["only-id"],
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const cloudProfiles = {} // All profiles deleted

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles, "only-profile")

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(true)
			expect(result.activeProfileId).toBeTruthy() // Should have new default profile ID

			const storedConfig = unwrapStoredProfiles(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs["default"]).toBeDefined()
			expect(storedConfig.apiConfigs["default"].id).toBe(result.activeProfileId)
		})

		it("should not mark active profile as changed when it's not affected", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "local-profile",
				apiConfigs: {
					"local-profile": { id: "local-id", apiProvider: "anthropic" as const },
					"cloud-profile": { id: "cloud-id", apiProvider: "openai" as const },
				},
				cloudProfileIds: ["cloud-id"],
			}

			mockSecrets.get.mockResolvedValue(storedProfiles(existingConfig))

			const cloudProfiles = {
				"cloud-profile": {
					id: "cloud-id",
					apiProvider: "openai" as const,
					apiModelId: "gpt-4", // Updated cloud profile
				},
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles, "local-profile")

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("local-id")
		})
	})

	describe("generateId", () => {
		// Regression test for CodeQL insecure-randomness alerts #9/#10:
		// generateId previously returned Math.random().toString(36).substring(2,15).
		// The id flows into profileId which indexes stored secrets
		// (allSecrets[profileId]), so a non-cryptographic PRNG made
		// secret-store keys predictable. generateId is public on the class,
		// so we can call it directly for an isolated white-box check.

		it("does not use Math.random (CSPRNG, not a non-cryptographic PRNG)", () => {
			const randomSpy = vi.spyOn(Math, "random").mockImplementation(() => 0)
			const id = providerSettingsManager.generateId()
			expect(randomSpy).not.toHaveBeenCalled()
			// Belt-and-suspenders: if Math.random (mocked to 0) had been used,
			// the old implementation would have produced an empty string.
			expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
			randomSpy.mockRestore()
		})

		it("returns a UUID v4 string (CSPRNG shape)", () => {
			const id = providerSettingsManager.generateId()
			expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
		})

		it("produces unique ids across many calls (collision sanity)", () => {
			const ids = new Set<string>()
			for (let i = 0; i < 1000; i++) {
				ids.add(providerSettingsManager.generateId())
			}
			expect(ids.size).toBe(1000)
		})
	})
})
