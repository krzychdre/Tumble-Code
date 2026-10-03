/**
 * Cloud-auth-only activation for `tumble auth cloud` (CLI_RUNTIME_ENV.cloudAuthOnly).
 *
 * The CLI signs in to the cloud without starting the whole extension: no
 * provider, webview, telemetry, indexing or terminals. It needs only the cloud
 * service, started on the same ExtensionContext (and so the same secrets file)
 * as a normal CLI run, so the credentials stored here are the ones the next
 * `tumble` session finds. The cloud URL overrides must already be applied
 * (`syncCloudUrls`), because the auth service fixes its credentials key from
 * the Clerk base URL when it is created.
 */

import type * as vscode from "vscode"

import type { CliCloudAuthApi, CliCloudAuthStatus } from "@tumble-code/types"
import { CloudService, getTumbleCodeApiUrl } from "@tumble-code/cloud"

/** The part of CloudService this module uses (a fake in tests). */
export type CloudAuthService = Pick<
	CloudService,
	"login" | "logout" | "handleAuthCallback" | "isAuthenticated" | "getAuthState" | "getUserInfo" | "on" | "off"
>

export interface CloudAuthOnlyDependencies {
	createCloudService?: (
		context: vscode.ExtensionContext,
		log: (...args: unknown[]) => void,
	) => Promise<CloudAuthService>
	disposeCloudService?: () => void
	getCloudApiUrl?: () => string
}

/**
 * How long `handleAuthCallback` waits for the auth service to pick up the
 * credentials it just stored (the secrets change event is handled
 * asynchronously).
 */
const CREDENTIALS_PICKUP_TIMEOUT_MS = 5_000

/** A session that needs no more waiting: signed out, inactive, or active with the user known. */
function isSettled(cloud: CloudAuthService): boolean {
	const state = cloud.getAuthState()

	return (
		state === "logged-out" ||
		state === "inactive-session" ||
		(state === "active-session" && cloud.getUserInfo() !== null)
	)
}

export async function activateCloudAuthOnly(
	context: vscode.ExtensionContext,
	log: (...args: unknown[]) => void,
	{
		createCloudService = (ctx, cloudLog) => CloudService.createInstance(ctx, cloudLog),
		disposeCloudService = () => CloudService.resetInstance(),
		getCloudApiUrl = getTumbleCodeApiUrl,
	}: CloudAuthOnlyDependencies = {},
): Promise<CliCloudAuthApi> {
	const cloud = await createCloudService(context, log)

	const getStatus = (): CliCloudAuthStatus => {
		const email = cloud.getUserInfo()?.email

		return {
			authenticated: cloud.isAuthenticated(),
			state: cloud.getAuthState(),
			...(email ? { userEmail: email } : {}),
			cloudApiUrl: getCloudApiUrl(),
		}
	}

	/** Resolves when `isDone` holds after an auth event (or at once), or after `timeoutMs`. */
	const waitFor = (isDone: () => boolean, timeoutMs: number) =>
		new Promise<void>((resolve) => {
			if (isDone()) {
				resolve()
				return
			}

			const check = () => {
				if (isDone()) {
					finish()
				}
			}
			const finish = () => {
				clearTimeout(timer)
				cloud.off("auth-state-changed", check)
				cloud.off("user-info", check)
				resolve()
			}
			const timer = setTimeout(finish, timeoutMs)
			cloud.on("auth-state-changed", check)
			cloud.on("user-info", check)
		})

	return {
		login: (authRedirect) => cloud.login({ authRedirect }),

		handleAuthCallback: async (code, state, organizationId) => {
			// The auth service moves to "attempting-session" once it has read the
			// new credentials; wait for that, so a status read right after this
			// call does not see the old (signed-out or previous) session.
			let pickedUp = false
			const onState = ({ state: next }: { state: string }) => {
				if (next === "attempting-session") {
					pickedUp = true
				}
			}
			cloud.on("auth-state-changed", onState)

			try {
				await cloud.handleAuthCallback(code, state, organizationId ?? null)
				await waitFor(() => pickedUp, CREDENTIALS_PICKUP_TIMEOUT_MS)
			} finally {
				cloud.off("auth-state-changed", onState)
			}
		},

		logout: () => cloud.logout(),

		getStatus,

		waitForSettledSession: async (timeoutMs) => {
			await waitFor(() => isSettled(cloud), timeoutMs)
			return getStatus()
		},

		dispose: () => disposeCloudService(),
	}
}
