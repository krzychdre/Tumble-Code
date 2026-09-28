import { imageGenerationSettingsMigration } from "./2025-08-29-image-generation-settings"
import { globalStateSecretsMigration } from "./2026-09-25-global-state-secrets"
import { invalidApiProviderMigration } from "./2025-12-05-invalid-api-provider"
import { legacyCondensingPromptMigration } from "./2026-01-21-legacy-condensing-prompt"
import { oldDefaultCondensingPromptMigration } from "./2026-01-23-old-default-condensing-prompt"
import { autoMemoryDefaultsMigration } from "./2026-07-13-auto-memory-defaults"
import type { ContextProxyMigration } from "./types"

/**
 * ContextProxy start-up migrations, in execution order (the order they had
 * in `ContextProxy.initialize()`, not date order). The legacy condensing
 * prompt move must stay before the v1-default cleanup.
 */
export const CONTEXT_PROXY_MIGRATIONS: readonly ContextProxyMigration[] = [
	imageGenerationSettingsMigration,
	globalStateSecretsMigration,
	invalidApiProviderMigration,
	legacyCondensingPromptMigration,
	oldDefaultCondensingPromptMigration,
	autoMemoryDefaultsMigration,
]
