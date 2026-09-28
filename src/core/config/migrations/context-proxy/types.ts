import type { ExtensionContext } from "vscode"

import type { GlobalState, SecretState } from "@roo-code/types"

import type { StartupMigration } from "../runner"

/**
 * What a ContextProxy start-up migration works on: the raw VS Code stores
 * plus ContextProxy's in-memory caches, which a migration keeps in step
 * with what it writes.
 */
export type ContextProxyMigrationContext = {
	globalState: ExtensionContext["globalState"]
	secrets: ExtensionContext["secrets"]
	stateCache: GlobalState
	secretCache: SecretState
	storeSecret(key: keyof SecretState, value?: string): Thenable<void>
}

export type ContextProxyMigration = StartupMigration<ContextProxyMigrationContext>
