import EventEmitter from "events"

import { jwtDecode } from "jwt-decode"
import type { ExtensionContext } from "vscode"

import type { JWTPayload, CloudUserInfo, AuthService, AuthServiceEvents, AuthState } from "@roo-code/types"

export class StaticTokenAuthService extends EventEmitter<AuthServiceEvents> implements AuthService {
	private state: AuthState = "active-session"
	private token: string
	private log: (...args: unknown[]) => void
	private userInfo: CloudUserInfo
	private exp: number | null
	private expiryTimer: ReturnType<typeof setTimeout> | null = null

	constructor(context: ExtensionContext, token: string, log?: (...args: unknown[]) => void) {
		super()

		this.token = token
		this.log = log || console.log

		this.log("[auth] Using StaticTokenAuthService")

		let payload

		try {
			payload = jwtDecode<JWTPayload>(token)
		} catch (error) {
			this.log("[auth] Failed to parse JWT:", error)
		}

		this.userInfo = {
			id: payload?.r?.u || payload?.sub || undefined,
			organizationId: payload?.r?.o || undefined,
		}

		this.exp = payload?.exp ?? null

		// If the JWT has an exp claim and is already expired, start in inactive-session.
		if (this.exp !== null && Date.now() >= this.exp * 1000) {
			this.state = "inactive-session"
			this.log("[auth] Static token JWT is already expired at construction")
		}
	}

	public async initialize(): Promise<void> {
		// If already expired at construction, stay in inactive-session.
		if (this.state === "inactive-session") {
			return
		}

		this.state = "active-session"
		this.scheduleExpiryTimer()
	}

	public broadcast(): void {
		this.emit("auth-state-changed", {
			state: this.state,
			previousState: "initializing",
		})

		this.emit("user-info", { userInfo: this.userInfo })
	}

	public async login(_landingPageSlug?: string, _useProviderSignup?: boolean): Promise<void> {
		throw new Error("Authentication methods are disabled in StaticTokenAuthService")
	}

	public async logout(): Promise<void> {
		throw new Error("Authentication methods are disabled in StaticTokenAuthService")
	}

	public async handleCallback(
		_code: string | null,
		_state: string | null,
		_organizationId?: string | null,
		_providerModel?: string | null,
	): Promise<void> {
		throw new Error("Authentication methods are disabled in StaticTokenAuthService")
	}

	public async switchOrganization(_organizationId: string | null): Promise<void> {
		throw new Error("Authentication methods are disabled in StaticTokenAuthService")
	}

	public async getOrganizationMemberships(): Promise<import("@roo-code/types").CloudOrganizationMembership[]> {
		throw new Error("Authentication methods are disabled in StaticTokenAuthService")
	}

	public getState(): AuthState {
		return this.state
	}

	public getSessionToken(): string | undefined {
		return this.token
	}

	/**
	 * Check if the user is authenticated.
	 *
	 * Tokens without an exp claim are always authenticated (back-compat for
	 * non-expiring static dev tokens). Tokens with an exp claim are
	 * authenticated only while the JWT is still valid; a live re-check
	 * guards against a missed/blocked timer.
	 */
	public isAuthenticated(): boolean {
		if (this.exp === null) {
			return true
		}

		if (Date.now() >= this.exp * 1000) {
			if (this.state === "active-session") {
				this.transitionToInactiveSession()
			}
			return false
		}

		return this.state === "active-session"
	}

	/**
	 * Check if the user has an active session.
	 *
	 * Same logic as isAuthenticated — always true for non-expiring tokens;
	 * live re-check for expiring tokens.
	 */
	public hasActiveSession(): boolean {
		return this.isAuthenticated()
	}

	public hasOrIsAcquiringActiveSession(): boolean {
		return this.isAuthenticated()
	}

	public getUserInfo(): CloudUserInfo | null {
		return this.userInfo
	}

	public getStoredOrganizationId(): string | null {
		return this.userInfo?.organizationId || null
	}

	/**
	 * Schedule a timer to fire at the JWT's expiry instant.
	 *
	 * Fires at exp (no skew margin — the live re-check in isAuthenticated
	 * handles the boundary). When it fires, transitions to inactive-session
	 * and emits auth-state-changed.
	 */
	private scheduleExpiryTimer(): void {
		if (this.exp === null) {
			return
		}

		this.clearExpiryTimer()

		const delayMs = this.exp * 1000 - Date.now()

		if (delayMs <= 0) {
			// Already expired — transition immediately.
			this.transitionToInactiveSession()
			return
		}

		this.expiryTimer = setTimeout(() => {
			this.transitionToInactiveSession()
		}, delayMs)
	}

	private clearExpiryTimer(): void {
		if (this.expiryTimer !== null) {
			clearTimeout(this.expiryTimer)
			this.expiryTimer = null
		}
	}

	private transitionToInactiveSession(): void {
		this.clearExpiryTimer()

		const previousState = this.state

		if (previousState === "inactive-session") {
			return
		}

		this.state = "inactive-session"
		this.log("[auth] Static token JWT expired, transitioning to inactive-session")
		this.emit("auth-state-changed", { state: this.state, previousState })
	}

	/**
	 * Dispose of the service and clean up resources.
	 *
	 * Not part of the AuthService interface, but should be called by the
	 * host when the service is being torn down.
	 */
	public dispose(): void {
		this.clearExpiryTimer()
	}
}
