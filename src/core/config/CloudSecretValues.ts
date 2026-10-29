import { type TumbleCodeSettings, SECRET_STATE_KEYS } from "@tumble-code/types"

import { logger } from "../../utils/logging"
import type { ContextProxy } from "./ContextProxy"
import type { ProviderSettingsManager } from "./ProviderSettingsManager"

/** The credentials and custom header values of one settings object. */
function secretValuesOf(settings: Partial<TumbleCodeSettings>): string[] {
	return [...SECRET_STATE_KEYS.map((key) => settings[key]), ...Object.values(settings.openAiHeaders ?? {})].filter(
		(value): value is string => typeof value === "string",
	)
}

/**
 * The values the cloud must never receive: the credentials and custom header values of
 * the live settings and of every stored provider profile, and the code-index keys. The
 * cloud reads `get` on every send, so the list is kept in memory and read again whenever
 * the extension's secret storage changes (the profiles are stored there too).
 */
export class CloudSecretValues {
	private values: readonly string[] = []

	constructor(
		private readonly contextProxy: ContextProxy,
		private readonly providerSettingsManager: ProviderSettingsManager,
	) {}

	readonly get = (): readonly string[] => this.values

	/** Never throws: on a failed read the previous values stay. */
	async refresh(): Promise<void> {
		try {
			const profiles = await this.providerSettingsManager.listProfileSettings()
			this.values = [this.contextProxy.getValues(), ...profiles].flatMap(secretValuesOf)
		} catch (error) {
			logger.error(
				`[CloudSecretValues] reading the stored secrets failed: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}
}
