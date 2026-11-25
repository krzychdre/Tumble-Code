/**
 * The editor's provider profiles, from the `vscode` section of cli-settings.json
 * (written by the extension, src/core/config/cliSettingsMirror.ts): the
 * connection and the model facts each mode runs with in VS Code. A run uses
 * them under everything the settings file and the flags say (run.ts).
 */

import {
	providerProfilesEnvelopeSchema,
	providerProfileToLegacySettings,
	type PersistedProviderProfile,
	type ProviderSettings,
} from "@tumble-code/types"

import type { CliModelSettings, ReasoningEffortFlagOptions } from "@/types/types.js"

import type { ProviderConfigLayer } from "./provider-config.js"
import { getBaseUrlField, getModelField, isSupportedProvider } from "./provider-types.js"

export interface VscodeProfile {
	/** Provider, model and base URL. The API key is not in the section: the CLI finds its own. */
	connection: ProviderConfigLayer
	/** What the profile says about its model (and its server's headers), as a `models` entry of cli-settings.json would. */
	modelSettings: CliModelSettings
}

export interface VscodeProfiles {
	/** The profile a mode runs with in VS Code: the one bound to it, else the current one. */
	forMode(mode: string | undefined): VscodeProfile | undefined
	/** The modes VS Code binds to a profile of their own. */
	boundModes: string[]
}

/**
 * The profiles of the section, or undefined when it has none or when another
 * version of the extension wrote them in a shape this CLI cannot read.
 */
export function readVscodeProfiles(envelope: unknown): VscodeProfiles | undefined {
	const parsed = providerProfilesEnvelopeSchema.safeParse(envelope)
	if (!parsed.success) {
		return undefined
	}
	const { currentApiConfigName, apiConfigs, modeApiConfigs = {} } = parsed.data.data
	const byId = new Map(Object.values(apiConfigs).map((profile) => [profile.id, profile]))
	const current = toVscodeProfile(apiConfigs[currentApiConfigName])
	return {
		forMode: (mode) => (mode ? toVscodeProfile(byId.get(modeApiConfigs[mode])) : undefined) ?? current,
		boundModes: Object.keys(modeApiConfigs),
	}
}

/** A profile of a provider the CLI runs; a retired provider's profile or an unknown provider gives none. */
function toVscodeProfile(profile: PersistedProviderProfile | undefined): VscodeProfile | undefined {
	if (!profile || !("config" in profile.provider)) {
		return undefined
	}
	const settings = providerProfileToLegacySettings(profile)
	const provider = settings.apiProvider
	if (!provider || !isSupportedProvider(provider)) {
		return undefined
	}
	const field = (key: string | undefined) => (key ? (settings[key as keyof ProviderSettings] as string) : undefined)
	return {
		connection: { provider, model: field(getModelField(provider)), baseUrl: field(getBaseUrlField(provider)) },
		modelSettings: definedOnly(modelSettingsOf(settings)),
	}
}

/** The model facts of a profile, named as in a `models` entry (types.ts, CliModelSettings). */
function modelSettingsOf(settings: ProviderSettings): CliModelSettings {
	const info = settings.apiProvider === "openai" ? settings.openAiCustomModelInfo : undefined
	const effort =
		settings.enableReasoningEffort === false
			? "disabled"
			: settings.enableReasoningEffort
				? (settings.reasoningEffort ?? info?.reasoningEffort)
				: undefined
	return {
		contextWindow: info?.contextWindow,
		inputPrice: info?.inputPrice,
		outputPrice: info?.outputPrice,
		cacheReadsPrice: info?.cacheReadsPrice,
		cacheWritesPrice: info?.cacheWritesPrice,
		supportsImages: info?.supportsImages,
		preserveReasoning: settings.apiProvider === "openai" ? settings.openAiPreserveReasoning : undefined,
		trimOldReasoning: settings.apiProvider === "openai" ? settings.openAiTrimOldReasoning : undefined,
		reasoningEffort: effort as ReasoningEffortFlagOptions | undefined,
		modelSize: settings.compactProfile ? "compact" : settings.slimToolset ? "slim" : undefined,
		hideMcp: settings.slimHidesMcp,
		maxConcurrentRequests: settings.maxConcurrentRequests,
		temperature: settings.modelTemperature ?? undefined,
		headers: settings.apiProvider === "openai" ? settings.openAiHeaders : undefined,
	}
}

/** The entries of `value` that are set. */
export function definedOnly<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}
