import type { ExtensionContext } from "vscode"

import type { ProviderProfileMigrations, ProviderProfilesData } from "@roo-code/types"

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
