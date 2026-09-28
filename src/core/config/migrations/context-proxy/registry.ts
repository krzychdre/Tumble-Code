import { globalStateSecretsMigration } from "./2026-09-25-global-state-secrets"
import { invalidApiProviderMigration } from "./2025-12-05-invalid-api-provider"
import { autoMemoryDefaultsMigration } from "./2026-07-13-auto-memory-defaults"
import type { ContextProxyMigration } from "./types"

/**
 * ContextProxy start-up migrations, in execution order (the order they had
 * in `ContextProxy.initialize()`, not date order). The image-generation
 * settings and both condensing prompt migrations were deleted on 2026-09-28
 * (ai_plans/2026-09-28_delete-old-config-migrations.md).
 */
export const CONTEXT_PROXY_MIGRATIONS: readonly ContextProxyMigration[] = [
	globalStateSecretsMigration,
	invalidApiProviderMigration,
	autoMemoryDefaultsMigration,
]
