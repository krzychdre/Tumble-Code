import type { ExtensionContext } from "vscode"

import { StaticTokenAuthService } from "../StaticTokenAuthService.js"

/** An unsigned JWT; the service only decodes it, it never verifies the signature. */
function makeJWT(claims: Record<string, unknown>): string {
	const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url")
	return `${b64url({ alg: "none", typ: "JWT" })}.${b64url(claims)}.`
}

const context = {} as ExtensionContext
const nowSeconds = () => Math.floor(Date.now() / 1000)

describe("StaticTokenAuthService", () => {
	let log: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>
	const services: StaticTokenAuthService[] = []

	const makeService = (token: string) => {
		const service = new StaticTokenAuthService(context, token, log)
		services.push(service)
		return service
	}

	beforeEach(() => {
		vi.useFakeTimers()
		log = vi.fn()
	})

	afterEach(() => {
		services.splice(0).forEach((service) => service.dispose())
		vi.useRealTimers()
	})

	it.each([
		[
			"a job token: user from r.u, organization from r.o",
			{ sub: "3", r: { u: "user_1", o: "org_1", t: "cj" } },
			"user_1",
			"org_1",
		],
		["a job token without an organization", { sub: "5", r: { u: "user_1", t: "cj" } }, "user_1", undefined],
		["a legacy token without r: user from sub", { sub: "user_123" }, "user_123", undefined],
	])("reads %s", (_name, claims, id, organizationId) => {
		const service = makeService(makeJWT(claims))

		expect(service.getUserInfo()).toEqual({ id, organizationId })
		expect(service.getStoredOrganizationId()).toBe(organizationId ?? null)
		expect(service.getSessionToken()).toBe(makeJWT(claims))
	})

	it.each(["not-a-jwt", "header.!!!invalid-base64!!!.signature"])(
		"keeps a token it cannot decode (%s) as a non-expiring session without a user",
		(token) => {
			const service = makeService(token)

			expect(service.getUserInfo()).toEqual({ id: undefined, organizationId: undefined })
			expect(service.getStoredOrganizationId()).toBeNull()
			expect(service.isAuthenticated()).toBe(true)
			expect(log).toHaveBeenCalledWith("[auth] Failed to parse JWT:", expect.any(Error))
		},
	)

	it("broadcasts its state and user only when asked, not on initialize", async () => {
		const service = makeService(makeJWT({ sub: "s", r: { u: "user_1", o: "org_1" } }))
		const stateChanged = vi.fn()
		const userInfo = vi.fn()
		service.on("auth-state-changed", stateChanged)
		service.on("user-info", userInfo)

		await service.initialize()
		expect(stateChanged).not.toHaveBeenCalled()

		service.broadcast()
		expect(stateChanged).toHaveBeenCalledWith({ state: "active-session", previousState: "initializing" })
		expect(userInfo).toHaveBeenCalledWith({ userInfo: { id: "user_1", organizationId: "org_1" } })
	})

	it.each([
		["login", (s: StaticTokenAuthService) => s.login()],
		["logout", (s: StaticTokenAuthService) => s.logout()],
		["handleCallback", (s: StaticTokenAuthService) => s.handleCallback("code", "state", "org_1")],
		["switchOrganization", (s: StaticTokenAuthService) => s.switchOrganization("org_1")],
		["getOrganizationMemberships", (s: StaticTokenAuthService) => s.getOrganizationMemberships()],
	])("refuses %s", async (_name, call) => {
		await expect(call(makeService("token"))).rejects.toThrow(
			"Authentication methods are disabled in StaticTokenAuthService",
		)
	})

	describe("JWT expiry (CB-3)", () => {
		const expectSession = (service: StaticTokenAuthService, active: boolean) => {
			expect(service.getState()).toBe(active ? "active-session" : "inactive-session")
			expect(service.isAuthenticated()).toBe(active)
			expect(service.hasActiveSession()).toBe(active)
			expect(service.hasOrIsAcquiringActiveSession()).toBe(active)
		}

		it("starts inactive with a token that has already expired", async () => {
			const service = makeService(makeJWT({ sub: "u", exp: nowSeconds() - 3600 }))
			const stateChanged = vi.fn()
			service.on("auth-state-changed", stateChanged)

			await service.initialize()

			expectSession(service, false)
			expect(stateChanged).not.toHaveBeenCalled()
		})

		it("goes inactive, once, when the expiry timer fires", async () => {
			const service = makeService(makeJWT({ sub: "u", exp: nowSeconds() + 3600 }))
			await service.initialize()
			const stateChanged = vi.fn()
			service.on("auth-state-changed", stateChanged)
			expectSession(service, true)

			vi.advanceTimersByTime(3600 * 1000 + 1)

			expectSession(service, false)
			expect(stateChanged).toHaveBeenCalledTimes(1)
			expect(stateChanged).toHaveBeenCalledWith({ state: "inactive-session", previousState: "active-session" })
		})

		it("goes inactive at once when the token expired between construction and initialize", async () => {
			const service = makeService(makeJWT({ sub: "u", exp: nowSeconds() + 10 }))
			const stateChanged = vi.fn()
			service.on("auth-state-changed", stateChanged)
			vi.setSystemTime(Date.now() + 20_000)

			await service.initialize()

			expect(stateChanged).toHaveBeenCalledWith({ state: "inactive-session", previousState: "active-session" })
			expectSession(service, false)
		})

		it("re-checks the expiry live when the timer was missed", async () => {
			const exp = nowSeconds() + 3600
			const service = makeService(makeJWT({ sub: "u", exp }))
			await service.initialize()

			// The clock moves on without the timer firing, as after a suspend.
			vi.setSystemTime((exp + 60) * 1000)

			expect(service.isAuthenticated()).toBe(false)
			expect(service.getState()).toBe("inactive-session")
		})

		it("stays active for ever with a token without exp", async () => {
			const service = makeService(makeJWT({ sub: "u" }))
			await service.initialize()

			vi.advanceTimersByTime(999_999_999)

			expectSession(service, true)
		})

		it("fires nothing after dispose", async () => {
			const service = makeService(makeJWT({ sub: "u", exp: nowSeconds() + 3600 }))
			await service.initialize()
			const stateChanged = vi.fn()
			service.on("auth-state-changed", stateChanged)

			service.dispose()
			vi.advanceTimersByTime(3600 * 1000 + 1)

			expect(stateChanged).not.toHaveBeenCalled()
			expect(service.getState()).toBe("active-session")
		})
	})
})
