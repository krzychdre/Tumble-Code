import { randomUUID } from "node:crypto"
import { ExtensionContext } from "vscode"
import { z, ZodError } from "zod"
import deepEqual from "fast-deep-equal"

import {
	classifyProvider,
	createKnownPersistedProviderProfile,
	createProviderProfilesEnvelope,
	parseProviderProfilesEnvelope,
	opaqueProviderProfileSchema,
	providerProfileToLegacySettings,
	providerProfilesDataSchema,
	type OpaqueProviderProfile,
	type PersistedProviderProfile,
	type ProviderProfilesData,
	type ProviderProfilesEnvelope,
	type ProviderSettings,
	type ProviderSettingsWithId,
	SECRET_STATE_KEYS,
	providerSettingsWithIdSchema,
	isSecretStateKey,
	ProviderSettingsEntry,
	getModelId,
	type ProviderName,
	TelemetryEventName,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Mode, modes } from "../../shared/modes"
import { resolveProviderModel } from "../../api"
import { logger } from "../../utils/logging"

export interface SyncCloudProfilesResult {
	hasChanges: boolean
	activeProfileChanged: boolean
	activeProfileId: string
}

/** Profiles as `store()` and `import()` take them: each one stored (v2) or flat, converted per profile. */
export type ProviderProfilesInput = Pick<
	ProviderProfilesData,
	"currentApiConfigName" | "modeApiConfigs" | "cloudProfileIds"
> & {
	apiConfigs: Record<string, ProviderSettingsWithId | (PersistedProviderProfile & Partial<ProviderSettingsWithId>)>
}
/** @deprecated Stage 6 flat fixture alias retained for external test compatibility. */
export type ProviderProfiles = ProviderProfilesInput

export const providerProfilesSchema = providerProfilesDataSchema

export class ProviderSettingsManager {
	private static readonly SCOPE_PREFIX = "roo_cline_config_"
	private readonly defaultConfigId = this.generateId()

	private readonly defaultModeApiConfigs: Record<string, string> = Object.fromEntries(
		modes.map((mode) => [mode.slug, this.defaultConfigId]),
	)

	private readonly defaultProviderProfiles: ProviderProfilesData = {
		currentApiConfigName: "default",
		apiConfigs: {
			default: { id: this.defaultConfigId, provider: { providerId: "anthropic", config: {} } },
		},
		modeApiConfigs: this.defaultModeApiConfigs,
	}

	private readonly context: ExtensionContext

	constructor(context: ExtensionContext) {
		this.context = context

		// TODO: We really shouldn't have async methods in the constructor.
		this.initialize().catch((error) => logger.error(error))
	}

	public generateId() {
		// CSPRNG id so profileId (which indexes stored secrets via
		// allSecrets[profileId]) is not predictable. Previously used
		// Math.random() — a non-cryptographic PRNG (CodeQL #9/#10).
		return randomUUID()
	}

	// Synchronize readConfig/writeConfig operations to avoid data loss.
	private _lock = Promise.resolve()
	private lock<T>(cb: () => Promise<T>) {
		const next = this._lock.then(cb)
		this._lock = next.catch(() => {
			// The caller gets `next`'s rejection; the chain itself must survive it.
		}) as Promise<void>
		return next
	}

	private isOpaqueProfile(profile: PersistedProviderProfile): profile is OpaqueProviderProfile {
		return !("config" in profile.provider)
	}

	private async toProviderSettings(profile: PersistedProviderProfile): Promise<ProviderSettingsWithId> {
		// Secrets live in `provider_profile_secrets_v2` for BOTH known and
		// opaque profiles (C1/C3). Opaque retired/unknown profiles no longer
		// carry inline SECRET_STATE_KEYS in their `opaqueLegacyPayload`, so the
		// secret store is the only source for them at read time.
		const secrets = profile.id ? (await this.loadProfileSecrets())[profile.id] : undefined
		if (this.isOpaqueProfile(profile)) {
			return {
				id: profile.id,
				...structuredClone(profile.provider.opaqueLegacyPayload),
				...(secrets ?? {}),
			} as ProviderSettingsWithId
		}

		return { id: profile.id, ...providerProfileToLegacySettings(profile), ...(secrets ?? {}) }
	}

	private get profileSecretsKey() {
		return `${ProviderSettingsManager.SCOPE_PREFIX}provider_profile_secrets_v2`
	}

	private async loadProfileSecrets(): Promise<Record<string, Record<string, unknown>>> {
		const value = await this.context.secrets.get(this.profileSecretsKey)
		if (!value) return {}
		let parsed: unknown
		try {
			parsed = JSON.parse(value)
		} catch {
			return {}
		}
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, Record<string, unknown>>)
			: {}
	}

	private async storeProfileSecrets(value: Record<string, Record<string, unknown>>): Promise<void> {
		if (Object.keys(value).length === 0) {
			await this.context.secrets.delete(this.profileSecretsKey)
			return
		}
		await this.context.secrets.store(this.profileSecretsKey, JSON.stringify(value))
	}

	private async updateProfileSecrets(profileId: string, config: ProviderSettingsWithId): Promise<void> {
		const allSecrets = await this.loadProfileSecrets()
		const hadProfileSecrets = profileId in allSecrets
		const profileSecrets = { ...(allSecrets[profileId] ?? {}) }
		for (const key of SECRET_STATE_KEYS) {
			const value = config[key]
			if (value === undefined) delete profileSecrets[key]
			else profileSecrets[key] = value
		}
		if (Object.keys(profileSecrets).length > 0) allSecrets[profileId] = profileSecrets
		else delete allSecrets[profileId]
		if (Object.keys(profileSecrets).length > 0 || hadProfileSecrets) await this.storeProfileSecrets(allSecrets)
	}

	private async deleteProfileSecrets(profileId: string): Promise<void> {
		const allSecrets = await this.loadProfileSecrets()
		if (!(profileId in allSecrets)) return
		delete allSecrets[profileId]
		await this.storeProfileSecrets(allSecrets)
	}

	/**
	 * Reads the store once, so a store this version cannot read (not the v2
	 * envelope) is reported at start-up. Nothing is written: a fresh install
	 * gets the default profile on its first save, and an unreadable store is
	 * left as it is.
	 */
	public async initialize() {
		try {
			await this.lock(() => this.load())
		} catch (error) {
			throw new Error(`Failed to initialize config: ${error}`)
		}
	}

	/**
	 * Clean model ID by removing prefix before "/"
	 */
	private cleanModelId(modelId: string | undefined): string | undefined {
		if (!modelId) return undefined

		// Check for "/" and take the part after it
		if (modelId.includes("/")) {
			return modelId.split("/").pop()
		}

		return modelId
	}

	/**
	 * List all available configs with metadata.
	 */
	public async listConfig(): Promise<ProviderSettingsEntry[]> {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()

				return await Promise.all(
					Object.entries(providerProfiles.apiConfigs).map(async ([name, persistedProfile]) => {
						const apiConfig = await this.toProviderSettings(persistedProfile)
						return {
							name,
							id: persistedProfile.id || "",
							apiProvider: apiConfig.apiProvider as ProviderSettingsEntry["apiProvider"],
							...(getModelId(apiConfig) ? { modelId: this.cleanModelId(getModelId(apiConfig)) } : {}),
						}
					}),
				)
			})
		} catch (error) {
			throw new Error(`Failed to list configs: ${error}`)
		}
	}

	/**
	 * Save a config with the given name.
	 * Preserves the ID from the input 'config' object if it exists,
	 * otherwise generates a new one (for creation scenarios).
	 */
	public async saveConfig(name: string, config: ProviderSettingsWithId): Promise<string> {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				// Preserve the existing ID if this is an update to an existing config.
				const existingId = providerProfiles.apiConfigs[name]?.id
				const id = config.id || existingId || this.generateId()

				// For active providers, filter out settings from other providers.
				// For retired providers, preserve full profile fields (including legacy
				// provider-specific keys) to avoid data loss — passthrough() keeps
				// unknown keys that strict parse() would strip.
				const classification = classifyProvider(config.apiProvider)
				const plaintextConfig = { ...config }
				for (const key of SECRET_STATE_KEYS) delete plaintextConfig[key]
				providerProfiles.apiConfigs[name] =
					classification === "retired" || classification === "unknown"
						? opaqueProviderProfileSchema.parse({
								id,
								provider: {
									providerId: config.apiProvider ?? "unknown",
									opaqueLegacyPayload: structuredClone(plaintextConfig),
								},
							})
						: createKnownPersistedProviderProfile({ ...plaintextConfig, id })
				await this.store(providerProfiles)
				await this.updateProfileSecrets(id, config)
				return id
			})
		} catch (error) {
			throw new Error(`Failed to save config: ${error}`)
		}
	}

	public async getProfile(
		params: { name: string } | { id: string },
	): Promise<ProviderSettingsWithId & { name: string }> {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				let name: string
				let providerSettings: PersistedProviderProfile

				if ("name" in params) {
					name = params.name

					if (!providerProfiles.apiConfigs[name]) {
						throw new Error(`Config with name '${name}' not found`)
					}

					providerSettings = providerProfiles.apiConfigs[name]
				} else {
					const id = params.id

					const entry = Object.entries(providerProfiles.apiConfigs).find(
						([_, apiConfig]) => apiConfig.id === id,
					)

					if (!entry) {
						throw new Error(`Config with ID '${id}' not found`)
					}

					name = entry[0]
					providerSettings = entry[1]
				}

				return { name, ...(await this.toProviderSettings(providerSettings)) }
			})
		} catch (error) {
			throw new Error(`Failed to get profile: ${error instanceof Error ? error.message : error}`)
		}
	}

	/**
	 * Activate a profile by name or ID.
	 */
	public async activateProfile(
		params: { name: string } | { id: string },
	): Promise<ProviderSettingsWithId & { name: string }> {
		const { name, ...providerSettings } = await this.getProfile(params)
		const classification = classifyProvider(providerSettings.apiProvider)
		if (classification === "retired" || classification === "unknown") {
			throw new Error(
				`Provider '${providerSettings.apiProvider ?? "unknown"}' is unavailable and cannot be activated.`,
			)
		}

		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				providerProfiles.currentApiConfigName = name
				await this.store(providerProfiles)
				return { name, ...providerSettings }
			})
		} catch (error) {
			throw new Error(`Failed to activate profile: ${error instanceof Error ? error.message : error}`)
		}
	}

	/**
	 * Delete a config by name.
	 */
	public async deleteConfig(name: string) {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()

				if (!providerProfiles.apiConfigs[name]) {
					throw new Error(`Config '${name}' not found`)
				}

				if (Object.keys(providerProfiles.apiConfigs).length === 1) {
					throw new Error(`Cannot delete the last remaining configuration`)
				}

				const profileId = providerProfiles.apiConfigs[name].id
				delete providerProfiles.apiConfigs[name]
				await this.store(providerProfiles)
				if (profileId) await this.deleteProfileSecrets(profileId)
			})
		} catch (error) {
			throw new Error(`Failed to delete config: ${error}`)
		}
	}

	/**
	 * Check if a config exists by name.
	 */
	public async hasConfig(name: string) {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				return name in providerProfiles.apiConfigs
			})
		} catch (error) {
			throw new Error(`Failed to check config existence: ${error}`)
		}
	}

	/**
	 * Set the API config for a specific mode.
	 */
	public async setModeConfig(mode: Mode, configId: string) {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				// Ensure the per-mode config map exists
				if (!providerProfiles.modeApiConfigs) {
					providerProfiles.modeApiConfigs = {}
				}
				// Assign the chosen config ID to this mode
				providerProfiles.modeApiConfigs[mode] = configId
				await this.store(providerProfiles)
			})
		} catch (error) {
			throw new Error(`Failed to set mode config: ${error}`)
		}
	}

	/**
	 * Set the API config for many modes at once.
	 *
	 * Used to fast-assign the active profile to all (or a chosen subset of)
	 * modes in a single store round-trip, instead of one lock+store per mode.
	 */
	public async setModeConfigs(modes: Mode[], configId: string) {
		if (modes.length === 0) {
			return
		}

		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				// Ensure the per-mode config map exists
				if (!providerProfiles.modeApiConfigs) {
					providerProfiles.modeApiConfigs = {}
				}
				// Assign the chosen config ID to every listed mode
				for (const mode of modes) {
					providerProfiles.modeApiConfigs[mode] = configId
				}
				await this.store(providerProfiles)
			})
		} catch (error) {
			throw new Error(`Failed to set mode configs: ${error}`)
		}
	}

	/**
	 * Get the API config ID for a specific mode.
	 */
	public async getModeConfigId(mode: Mode) {
		try {
			return await this.lock(async () => {
				const { modeApiConfigs } = await this.load()
				return modeApiConfigs?.[mode]
			})
		} catch (error) {
			throw new Error(`Failed to get mode config: ${error}`)
		}
	}

	/** The stored profiles as they are (no secrets); unlike `export()`, nothing is filtered out. */
	public async readProfiles(): Promise<ProviderProfilesData> {
		try {
			return await this.lock(async () => structuredClone(await this.load()))
		} catch (error) {
			throw new Error(`Failed to read provider profiles: ${error}`)
		}
	}

	public async export(): Promise<ProviderProfilesEnvelope> {
		try {
			return await this.lock(async () => {
				const profiles = structuredClone(providerProfilesSchema.parse(await this.load()))
				const configs = profiles.apiConfigs
				for (const name in configs) {
					const persistedProfile = configs[name]
					if (this.isOpaqueProfile(persistedProfile)) {
						// Preserve retired and future-provider profiles as opaque payloads.
						continue
					}

					// Resolve the profile's model information (no handler is built)
					try {
						const modelInfo = resolveProviderModel(providerProfileToLegacySettings(persistedProfile)).info

						// Check if the model supports reasoning budgets
						const supportsReasoningBudget =
							modelInfo.supportsReasoningBudget || modelInfo.requiredReasoningBudget

						// modelMaxThinkingTokens only applies to reasoning budgets, but modelMaxTokens
						// also caps output on models that expose a configurable max (e.g. GLM), so keep
						// it whenever the model supports either feature.
						const supportsMaxTokens = supportsReasoningBudget || modelInfo.supportsMaxTokens

						if (!supportsReasoningBudget) {
							delete persistedProfile.shared?.modelMaxThinkingTokens
						}

						if (!supportsMaxTokens) {
							delete persistedProfile.shared?.modelMaxTokens
						}
					} catch (error) {
						// If we can't resolve the model info, skip filtering
						// to avoid accidental data loss from incomplete configurations
						logger.warn(`Skipping token field filtering for config '${name}': ${error}`)
					}
				}
				return createProviderProfilesEnvelope(profiles)
			})
		} catch (error) {
			throw new Error(`Failed to export provider profiles: ${error}`)
		}
	}

	/**
	 * Replaces every profile. Secrets are not part of the input: the ones stored
	 * for a profile id stay attached to that id.
	 */
	public async import(providerProfiles: ProviderProfilesInput) {
		try {
			return await this.lock(() => this.store(providerProfiles))
		} catch (error) {
			throw new Error(`Failed to import provider profiles: ${error}`)
		}
	}

	/**
	 * Reset provider profiles by deleting them from secrets.
	 */
	public async resetAllConfigs() {
		return await this.lock(async () => {
			await this.context.secrets.delete(this.secretsKey)
		})
	}

	private get secretsKey() {
		return `${ProviderSettingsManager.SCOPE_PREFIX}api_config`
	}

	private async load(): Promise<ProviderProfilesData> {
		try {
			const content = await this.context.secrets.get(this.secretsKey)

			if (!content) {
				return this.defaultProviderProfiles
			}

			return parseProviderProfilesEnvelope(JSON.parse(content)).data
		} catch (error) {
			if (error instanceof ZodError && TelemetryService.hasInstance()) {
				TelemetryService.instance.capture(TelemetryEventName.SCHEMA_VALIDATION_ERROR, {
					schemaName: "ProviderProfiles",
					error: error.format(),
				})
			}

			throw new Error(`Failed to read provider profiles from secrets: ${error}`)
		}
	}

	private async store(providerProfiles: ProviderProfilesInput) {
		try {
			const apiConfigs = Object.fromEntries(
				Object.entries(providerProfiles.apiConfigs).map(([name, profile]) => [
					name,
					"provider" in profile ? profile : createKnownPersistedProviderProfile(profile),
				]),
			)
			const envelope = createProviderProfilesEnvelope({ ...providerProfiles, apiConfigs })
			await this.context.secrets.store(this.secretsKey, JSON.stringify(envelope, null, 2))
		} catch (error) {
			throw new Error(`Failed to write provider profiles to secrets: ${error}`)
		}
	}

	private findUniqueProfileName(baseName: string, existingNames: Set<string>): string {
		if (!existingNames.has(baseName)) {
			return baseName
		}

		// Try _local first
		const localName = `${baseName}_local`
		if (!existingNames.has(localName)) {
			return localName
		}

		// Try _1, _2, etc.
		let counter = 1
		let candidateName: string
		do {
			candidateName = `${baseName}_${counter}`
			counter++
		} while (existingNames.has(candidateName))

		return candidateName
	}

	public async syncCloudProfiles(
		cloudProfiles: Record<string, ProviderSettingsWithId>,
		currentActiveProfileName?: string,
	): Promise<SyncCloudProfilesResult> {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				const changedProfiles: string[] = []
				const existingNames = new Set(Object.keys(providerProfiles.apiConfigs))

				let activeProfileChanged = false
				let activeProfileId = ""

				if (currentActiveProfileName && providerProfiles.apiConfigs[currentActiveProfileName]) {
					activeProfileId = providerProfiles.apiConfigs[currentActiveProfileName].id || ""
				}

				const currentCloudIds = new Set(providerProfiles.cloudProfileIds || [])
				const newCloudIds = new Set(
					Object.values(cloudProfiles)
						.map((p) => p.id)
						.filter((id): id is string => Boolean(id)),
				)

				// Step 1: Delete profiles that are cloud-managed but not in the new cloud profiles
				for (const [name, profile] of Object.entries(providerProfiles.apiConfigs)) {
					if (profile.id && currentCloudIds.has(profile.id) && !newCloudIds.has(profile.id)) {
						// Check if we're deleting the active profile
						if (name === currentActiveProfileName) {
							activeProfileChanged = true
							activeProfileId = "" // Clear the active profile ID since it's being deleted
						}
						delete providerProfiles.apiConfigs[name]
						changedProfiles.push(name)
						existingNames.delete(name)
					}
				}

				// Step 2: Process each cloud profile
				for (const [cloudName, cloudProfile] of Object.entries(cloudProfiles)) {
					if (!cloudProfile.id) {
						continue // Skip profiles without IDs
					}

					// Find existing profile with matching ID
					const existingEntry = Object.entries(providerProfiles.apiConfigs).find(
						([_, profile]) => profile.id === cloudProfile.id,
					)

					if (existingEntry) {
						// Step 3: Update existing profile
						const [existingName, existingProfile] = existingEntry

						// Check if this is the active profile
						const isActiveProfile = existingName === currentActiveProfileName

						// Merge settings, preserving secret keys
						const updatedProfile = createKnownPersistedProviderProfile({
							...(await this.toProviderSettings(existingProfile)),
							...cloudProfile,
						})
						const runtimeChanged = !deepEqual(await this.toProviderSettings(existingProfile), {
							...(await this.toProviderSettings(existingProfile)),
							...cloudProfile,
						})

						// Check if the profile actually changed using deepEqual
						const profileChanged = !deepEqual(existingProfile, updatedProfile)

						// Handle name change
						if (existingName !== cloudName) {
							// Remove old entry
							delete providerProfiles.apiConfigs[existingName]
							existingNames.delete(existingName)

							// Handle name conflict
							const finalName = cloudName
							if (existingNames.has(cloudName)) {
								// There's a conflict - rename the existing non-cloud profile
								const conflictingProfile = providerProfiles.apiConfigs[cloudName]
								if (conflictingProfile.id !== cloudProfile.id) {
									const newName = this.findUniqueProfileName(cloudName, existingNames)
									providerProfiles.apiConfigs[newName] = conflictingProfile
									existingNames.add(newName)
									changedProfiles.push(newName)
								}
								delete providerProfiles.apiConfigs[cloudName]
								existingNames.delete(cloudName)
							}

							// Add updated profile with new name
							providerProfiles.apiConfigs[finalName] = updatedProfile
							existingNames.add(finalName)
							changedProfiles.push(finalName)
							if (existingName !== finalName) {
								changedProfiles.push(existingName) // Mark old name as changed (deleted)
							}

							// If this was the active profile, mark it as changed
							if (isActiveProfile && runtimeChanged) {
								activeProfileChanged = true
								activeProfileId = cloudProfile.id || ""
							}
						} else if (profileChanged) {
							// Same name, but profile content changed - update in place
							providerProfiles.apiConfigs[existingName] = updatedProfile
							changedProfiles.push(existingName)

							// If this was the active profile and settings changed, mark it as changed
							if (isActiveProfile && runtimeChanged) {
								activeProfileChanged = true
								activeProfileId = cloudProfile.id || ""
							}
						}
						// If name is the same and profile hasn't changed, do nothing
					} else {
						// Step 4: Add new cloud profile
						const finalName = cloudName

						// Handle name conflict with existing non-cloud profile
						if (existingNames.has(cloudName)) {
							const existingProfile = providerProfiles.apiConfigs[cloudName]
							if (existingProfile.id !== cloudProfile.id) {
								// Rename the existing profile
								const newName = this.findUniqueProfileName(cloudName, existingNames)
								providerProfiles.apiConfigs[newName] = existingProfile
								existingNames.add(newName)
								changedProfiles.push(newName)

								// Remove the old entry
								delete providerProfiles.apiConfigs[cloudName]
								existingNames.delete(cloudName)
							}
						}

						// Add the new cloud profile (without secret keys)
						const newProfile = createKnownPersistedProviderProfile(cloudProfile)

						providerProfiles.apiConfigs[finalName] = newProfile
						existingNames.add(finalName)
						changedProfiles.push(finalName)
					}
				}

				// Step 5: Handle case where all profiles might be deleted
				if (Object.keys(providerProfiles.apiConfigs).length === 0 && changedProfiles.length > 0) {
					// Create a default profile only if we have changed profiles
					const defaultProfile: PersistedProviderProfile = {
						id: this.generateId(),
						provider: { providerId: "anthropic", config: {} },
					}
					providerProfiles.apiConfigs["default"] = defaultProfile
					activeProfileChanged = true
					activeProfileId = defaultProfile.id || ""
					changedProfiles.push("default")
				}

				// Step 6: If active profile was deleted, find a replacement
				if (activeProfileChanged && !activeProfileId) {
					const firstProfile = Object.values(providerProfiles.apiConfigs)[0]
					if (firstProfile?.id) {
						activeProfileId = firstProfile.id
					}
				}

				// Step 7: Update cloudProfileIds
				providerProfiles.cloudProfileIds = Array.from(newCloudIds)

				// Save the updated profiles
				await this.store(providerProfiles)

				return {
					hasChanges: changedProfiles.length > 0,
					activeProfileChanged,
					activeProfileId,
				}
			})
		} catch (error) {
			throw new Error(`Failed to sync cloud profiles: ${error}`)
		}
	}
}
