import { CloudService } from "@roo-code/cloud"

import type { ContextProxy } from "../config/ContextProxy"
import type { ProviderSettingsManager } from "../config/ProviderSettingsManager"

/**
 * What the cloud profile sync needs from its provider. The member names match
 * ClineProvider's, so the provider hands in closures over itself (which also
 * pick up methods that tests replace on the instance) and a test can hand in
 * a plain object.
 */
export interface CloudProfileSyncHost {
	readonly contextProxy: Pick<ContextProxy, "getValue" | "setValue">
	readonly providerSettingsManager: Pick<ProviderSettingsManager, "syncCloudProfiles" | "listConfig" | "getProfile">
	activateProviderProfile(args: { name: string }): Promise<unknown>
	postStateToWebviewWithoutClineMessages(): Promise<void>
	log(message: string): void
}

/**
 * Keeps the local provider profiles in step with the profiles of the
 * signed-in cloud organization (CORE-R6 b).
 *
 * The CloudService singleton is read on every call, not captured: extension
 * activation may create it after the provider, and then calls
 * {@link initializeWhenReady} again.
 */
export class CloudProfileSync {
	constructor(private readonly host: CloudProfileSyncHost) {}

	/** The settings-updated listener; a stable reference so `off` finds it. */
	private readonly handleSettingsUpdate = async () => {
		try {
			await this.sync()
		} catch (error) {
			this.host.log(`Error handling cloud settings update: ${error}`)
		}
	}

	/**
	 * Synchronize cloud profiles with local profiles. Never throws.
	 */
	async sync(): Promise<void> {
		try {
			const settings = CloudService.instance.getOrganizationSettings()

			if (!settings?.providerProfiles) {
				return
			}

			const currentApiConfigName = this.host.contextProxy.getValue("currentApiConfigName")

			const result = await this.host.providerSettingsManager.syncCloudProfiles(
				settings.providerProfiles,
				currentApiConfigName,
			)

			if (result.hasChanges) {
				// Update list.
				await this.host.contextProxy.setValue(
					"listApiConfigMeta",
					await this.host.providerSettingsManager.listConfig(),
				)

				if (result.activeProfileChanged && result.activeProfileId) {
					// Reload full settings for new active profile.
					const profile = await this.host.providerSettingsManager.getProfile({
						id: result.activeProfileId,
					})
					await this.host.activateProviderProfile({ name: profile.name })
				}

				await this.host.postStateToWebviewWithoutClineMessages()
			}
		} catch (error) {
			this.host.log(`Error syncing cloud profiles: ${error}`)
		}
	}

	/**
	 * Sync now if signed in, and (re)subscribe to settings updates.
	 * Idempotent, never throws. Called from the provider's constructor when
	 * CloudService already exists and again by extension activation once
	 * CloudService has been initialized.
	 */
	async initializeWhenReady(): Promise<void> {
		try {
			if (CloudService.hasInstance() && CloudService.instance.isAuthenticated()) {
				await this.sync()
			}

			if (CloudService.hasInstance()) {
				CloudService.instance.off("settings-updated", this.handleSettingsUpdate)
				CloudService.instance.on("settings-updated", this.handleSettingsUpdate)
			}
		} catch (error) {
			this.host.log(`Failed to initialize cloud profile sync when ready: ${error}`)
		}
	}

	/** Remove the settings-updated listener. */
	dispose(): void {
		if (CloudService.hasInstance()) {
			CloudService.instance.off("settings-updated", this.handleSettingsUpdate)
		}
	}
}
