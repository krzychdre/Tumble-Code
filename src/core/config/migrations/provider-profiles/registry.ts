import { rateLimitSecondsMigration } from "./2025-04-07-rate-limit-seconds"
import { openAiHeadersMigration } from "./2025-05-01-openai-headers"
import { consecutiveMistakeLimitMigration } from "./2025-07-15-consecutive-mistake-limit"
import { todoListEnabledMigration } from "./2025-07-21-todo-list-enabled"
import { claudeCodeLegacySettingsMigration } from "./2025-12-17-claude-code-legacy-settings"
import type { ProviderProfileMigration } from "./types"

/**
 * One-shot provider-profile migrations, in execution order. The done-record
 * is the `migrations` object inside the stored profiles envelope
 * (`providerProfileMigrationsSchema` in @roo-code/types lists one flag per
 * entry here; add the flag there when adding a migration).
 */
export const PROVIDER_PROFILE_MIGRATIONS: readonly ProviderProfileMigration[] = [
	rateLimitSecondsMigration,
	openAiHeadersMigration,
	consecutiveMistakeLimitMigration,
	todoListEnabledMigration,
	claudeCodeLegacySettingsMigration,
]
