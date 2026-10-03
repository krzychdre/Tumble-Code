import {
	DEFAULT_MODES,
	SETTINGS_DEFAULTS,
	type ProviderSettingsEntry,
	type TumbleCodeSettings,
} from "@tumble-code/types"

import type { ContextProxy } from "../config/ContextProxy"
import type { ProviderState } from "./ProviderStateBuilder"

/**
 * What {@link ModeProfileQueries} needs from its host (ClineProvider),
 * following the "declare what I touch" seam convention.
 */
export interface ModeProfileQueriesHost {
	/** The custom modes of the workspace (.roomodes + global settings). */
	getCustomModes(): Promise<{ slug: string; name: string }[]>
	/** The settings accessor; `mode`, `listApiConfigMeta` and `currentApiConfigName` are read here. */
	getState(): Promise<ProviderState>
	/** Persists settings (setMode writes `mode`). */
	setValues(values: TumbleCodeSettings): Promise<void>
	/** Raw settings access for the profile-entry reads and the delete rewrite. */
	readonly contextProxy: Pick<ContextProxy, "getValues" | "setValues">
	/** Pushes the refreshed state to the webview after a profile delete. */
	postStateToWebview(): Promise<void>
}

/**
 * The provider's read-side mode and provider-profile queries (R3-12 cluster
 * 3; was inline in ClineProvider): the mode list (defaults + custom), the
 * current mode, the profile list/entry lookups and the profile delete with
 * its next-profile-to-activate choice.
 *
 * The write side (mode switches, profile activation/upsert) already lives in
 * {@link ModeProfileBinding}. ClineProvider keeps thin delegating members
 * because `TaskProviderLike` pins the mode/profile members on the provider
 * and `extension/api.ts` + the messageHandlers call them there.
 */
export class ModeProfileQueries {
	constructor(private readonly host: ModeProfileQueriesHost) {}

	/** All modes (built-in + custom), reduced to slug/name; falls back to the built-ins. */
	async getModes(): Promise<{ slug: string; name: string }[]> {
		try {
			const customModes = await this.host.getCustomModes()
			return [...DEFAULT_MODES, ...customModes].map(({ slug, name }) => ({ slug, name }))
		} catch (error) {
			return DEFAULT_MODES.map(({ slug, name }) => ({ slug, name }))
		}
	}

	/** The current mode slug. */
	async getMode(): Promise<string> {
		const { mode } = await this.host.getState()
		return mode
	}

	/** Persists a new current mode (the webview refresh is driven by the ContextProxy change, not here). */
	async setMode(mode: string): Promise<void> {
		await this.host.setValues({ mode })
	}

	/** All provider profiles, reduced to name/provider. */
	async getProviderProfiles(): Promise<{ name: string; provider?: string }[]> {
		const { listApiConfigMeta = [] } = await this.host.getState()
		return listApiConfigMeta.map((profile) => ({ name: profile.name, provider: profile.apiProvider }))
	}

	/** The currently active profile name. */
	async getProviderProfile(): Promise<string> {
		const { currentApiConfigName = SETTINGS_DEFAULTS.currentApiConfigName } = await this.host.getState()
		return currentApiConfigName
	}

	/** The stored profile entries (name/provider/id metadata only). */
	getProviderProfileEntries(): ProviderSettingsEntry[] {
		return this.host.contextProxy.getValues().listApiConfigMeta || []
	}

	/** One stored profile entry by name. */
	getProviderProfileEntry(name: string): ProviderSettingsEntry | undefined {
		return this.getProviderProfileEntries().find((profile) => profile.name === name)
	}

	/**
	 * Deletes a profile entry: when the deleted one is active, activate the
	 * next remaining entry first; the last profile cannot be deleted.
	 */
	async deleteProviderProfile(profileToDelete: ProviderSettingsEntry): Promise<void> {
		const globalSettings = this.host.contextProxy.getValues()
		let profileToActivate: string | undefined = globalSettings.currentApiConfigName

		if (profileToDelete.name === profileToActivate) {
			profileToActivate = this.getProviderProfileEntries().find(({ name }) => name !== profileToDelete.name)?.name
		}

		if (!profileToActivate) {
			throw new Error("You cannot delete the last profile")
		}

		const entries = this.getProviderProfileEntries().filter(({ name }) => name !== profileToDelete.name)

		await this.host.contextProxy.setValues({
			...globalSettings,
			currentApiConfigName: profileToActivate,
			listApiConfigMeta: entries,
		})

		await this.host.postStateToWebview()
	}
}
