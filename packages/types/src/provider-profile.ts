import { z } from "zod"

import {
	narrowedProviderSettingsSchema,
	opaqueNarrowedProviderSettingsSchema,
	providerConfigSchemas,
	type KnownProviderId,
} from "./provider-config/index.js"
import { classifyProvider } from "./provider-registry.js"
import { providerSettingsSchema, type ProviderSettings, type ProviderSettingsWithId } from "./provider-settings.js"
import { SECRET_STATE_KEYS } from "./global-settings.js"

export const PROVIDER_PROFILES_SCHEMA_VERSION = 2 as const

export const knownPersistedProviderProfileSchema = z
	.object({ id: z.string().optional() })
	.merge(narrowedProviderSettingsSchema)
	.strict()
export const opaqueProviderProfileSchema = z
	.object({ id: z.string().optional() })
	.merge(opaqueNarrowedProviderSettingsSchema)
	.strict()
export const persistedProviderProfileSchema = z.union([
	knownPersistedProviderProfileSchema,
	opaqueProviderProfileSchema,
])

export type PersistedProviderProfile = z.infer<typeof persistedProviderProfileSchema>
export type OpaqueProviderProfile = z.infer<typeof opaqueProviderProfileSchema>

export const providerProfilesDataSchema = z
	.object({
		currentApiConfigName: z.string(),
		apiConfigs: z.record(z.string(), persistedProviderProfileSchema),
		modeApiConfigs: z.record(z.string(), z.string()).optional(),
		cloudProfileIds: z.array(z.string()).optional(),
	})
	.passthrough()

export type ProviderProfilesData = z.infer<typeof providerProfilesDataSchema>

export const providerProfilesEnvelopeSchema = z
	.object({
		schemaVersion: z.literal(PROVIDER_PROFILES_SCHEMA_VERSION),
		data: providerProfilesDataSchema,
	})
	.passthrough()

export type ProviderProfilesEnvelope = z.infer<typeof providerProfilesEnvelopeSchema>

/**
 * Thrown for stored or imported provider profiles that are not the current envelope
 * (`{ schemaVersion: 2, data }`). Older shapes are no longer migrated.
 */
export class UnsupportedProviderProfilesVersionError extends Error {
	readonly code = "UNSUPPORTED_PROVIDER_PROFILES_VERSION"

	constructor(
		readonly schemaVersion: unknown,
		readonly supportedSchemaVersion = PROVIDER_PROFILES_SCHEMA_VERSION,
	) {
		super(
			`Provider profiles have schema version ${schemaVersion === undefined ? "(none)" : String(schemaVersion)}, ` +
				`only version ${supportedSchemaVersion} is supported. Profiles saved or exported by an older version ` +
				`are not converted: reset the settings (Settings > About > Reset) and recreate the profiles, ` +
				`or import a file exported by this version.`,
		)
		this.name = "UnsupportedProviderProfilesVersionError"
	}
}

const sharedFieldNames = [
	"includeMaxTokens",
	"todoListEnabled",
	"enableReasoningEffort",
	"modelTemperature",
	"rateLimitSeconds",
	"consecutiveMistakeLimit",
	"slimToolset",
	"slimHidesMcp",
	"reasoningEffort",
	"modelMaxTokens",
	"modelMaxThinkingTokens",
	"verbosity",
	"codebaseIndexOpenAiCompatibleBaseUrl",
	"codebaseIndexOpenAiCompatibleModelDimension",
] as const satisfies readonly (keyof ProviderSettings)[]

/**
 * The persisted config fields of each provider, read from its config schema
 * (the one list of them). Shared fields and credentials are not part of it.
 */
export const providerFieldOwnership = {} as Record<KnownProviderId, readonly string[]>
for (const providerId of Object.keys(providerConfigSchemas) as KnownProviderId[]) {
	providerFieldOwnership[providerId] = Object.keys(providerConfigSchemas[providerId].shape)
}

const pickPresent = (value: Record<string, unknown>, keys: readonly PropertyKey[]): Record<string, unknown> => {
	const picked: Record<string, unknown> = {}
	for (const key of keys) {
		if (typeof key === "string" && Object.prototype.hasOwnProperty.call(value, key)) {
			picked[key] = value[key]
		}
	}
	return picked
}

/**
 * Strip every SECRET_STATE_KEYS entry from a flat profile so opaque
 * tombstones never carry plaintext secrets to disk. Known-provider configs
 * already lose secrets via `pickPresent(providerFieldOwnership[...])` because
 * the ownership map deliberately excludes secret keys, so this is only
 * required for the opaque branch.
 */
const stripSecretStateKeys = <T extends Record<string, unknown>>(profile: T): T => {
	const stripped = { ...profile }
	for (const key of SECRET_STATE_KEYS) {
		delete stripped[key]
	}
	return stripped
}

/**
 * The stored (v2) form of a flat profile, the shape the running extension uses. Credentials are
 * not part of it: they live in the profile secret store.
 */
const toPersistedProviderProfile = (profile: Record<string, unknown>): PersistedProviderProfile => {
	const providerId = profile.apiProvider
	const classification = classifyProvider(providerId)
	if (classification !== "known-active" && classification !== "known-hidden") {
		return {
			...(typeof profile.id === "string" ? { id: profile.id } : {}),
			provider: {
				providerId: typeof providerId === "string" ? providerId : "unknown",
				opaqueLegacyPayload: structuredClone(stripSecretStateKeys(profile)),
			},
		}
	}

	const knownProviderId = providerId as KnownProviderId
	const shared = pickPresent(profile, sharedFieldNames)
	return {
		...(typeof profile.id === "string" ? { id: profile.id } : {}),
		provider: {
			providerId: knownProviderId,
			config: pickPresent(profile, providerFieldOwnership[knownProviderId]),
		},
		...(Object.keys(shared).length > 0 ? { shared } : {}),
	} as PersistedProviderProfile
}

export const createKnownPersistedProviderProfile = (profile: ProviderSettingsWithId): PersistedProviderProfile => {
	const parsed = providerSettingsSchema.passthrough().parse(profile)
	const classification = classifyProvider(parsed.apiProvider)
	if (classification !== "known-active" && classification !== "known-hidden") {
		throw new Error(
			`Provider '${parsed.apiProvider ?? "unknown"}' is unavailable and cannot be saved as an active profile.`,
		)
	}

	return knownPersistedProviderProfileSchema.parse(toPersistedProviderProfile(profile))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

/** The current envelope, validated. Anything else throws {@link UnsupportedProviderProfilesVersionError}. */
export const parseProviderProfilesEnvelope = (input: unknown): ProviderProfilesEnvelope => {
	const schemaVersion = isRecord(input) ? input.schemaVersion : undefined
	if (schemaVersion !== PROVIDER_PROFILES_SCHEMA_VERSION) {
		throw new UnsupportedProviderProfilesVersionError(schemaVersion)
	}

	return providerProfilesEnvelopeSchema.parse(input)
}

export const createProviderProfilesEnvelope = (data: ProviderProfilesData): ProviderProfilesEnvelope =>
	providerProfilesEnvelopeSchema.parse({ schemaVersion: PROVIDER_PROFILES_SCHEMA_VERSION, data })
