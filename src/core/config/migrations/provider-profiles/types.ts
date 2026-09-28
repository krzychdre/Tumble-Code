import type { ExtensionContext } from "vscode"

import type {
	OpaqueProviderProfile,
	PersistedProviderProfile,
	ProviderProfileMigrations,
	ProviderProfilesData,
} from "@roo-code/types"

import type { FlaggedMigration } from "../runner"

/** What a provider-profile migration may read besides the profiles. */
export type ProviderProfileMigrationContext = {
	globalState: Pick<ExtensionContext["globalState"], "get">
}

export type ProviderProfileMigration = FlaggedMigration<
	keyof ProviderProfileMigrations,
	ProviderProfilesData,
	ProviderProfileMigrationContext
>

/** Retired or unknown providers are stored opaquely (no typed `config`). */
export const isOpaqueProfile = (profile: PersistedProviderProfile): profile is OpaqueProviderProfile =>
	!("config" in profile.provider)
