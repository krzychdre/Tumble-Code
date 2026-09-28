import type { ProviderProfileMigrations } from "@roo-code/types"

import type { ProviderProfileMigration } from "./types"

/**
 * One-shot provider-profile migrations, in execution order. The done-record
 * is the `migrations` object inside the stored profiles envelope
 * (`providerProfileMigrationsSchema` in @roo-code/types lists one flag per
 * entry here; add the flag there when adding a migration).
 *
 * Empty since 2026-09-28: the five original migrations were deleted
 * (ai_plans/2026-09-28_delete-old-config-migrations.md).
 */
export const PROVIDER_PROFILE_MIGRATIONS: readonly ProviderProfileMigration[] = []

/**
 * Flags of deleted migrations. The migrations schema is strict, so these
 * stay in it as optional keys: stored envelopes written by older versions
 * carry them and must still parse. Never reuse one for a new migration
 * (installs that recorded it as done would skip the new one).
 *
 * - rateLimitSecondsMigrated (2025-04-07): global rate limit copied into each profile
 * - openAiHeadersMigrated (2025-05-01): openAiHostHeader turned into openAiHeaders.Host
 * - consecutiveMistakeLimitMigrated (2025-07-15): per-profile default filled in
 * - todoListEnabledMigrated (2025-07-21): per-profile default filled in
 * - claudeCodeLegacySettingsMigrated (2025-12-17): removed Claude Code CLI keys deleted
 */
export const RETIRED_PROVIDER_PROFILE_MIGRATION_FLAGS = [
	"rateLimitSecondsMigrated",
	"openAiHeadersMigrated",
	"consecutiveMistakeLimitMigrated",
	"todoListEnabledMigrated",
	"claudeCodeLegacySettingsMigrated",
] as const satisfies readonly (keyof ProviderProfileMigrations)[]
