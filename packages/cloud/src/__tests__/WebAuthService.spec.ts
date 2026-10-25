// npx vitest run src/__tests__/WebAuthService.spec.ts

import crypto from "crypto"

import type { Mock } from "vitest"
import * as vscode from "vscode"
import type { ExtensionContext } from "vscode"

import { WebAuthService } from "../WebAuthService.js"
import { RefreshTimer } from "../RefreshTimer.js"
import { getClerkBaseUrl, getTumbleCodeApiUrl } from "../config.js"
import { getUserAgent } from "../utils.js"

vi.mock("crypto")
vi.mock("../RefreshTimer")
vi.mock("../config")
vi.mock("../utils")

vi.mock("vscode", () => ({
	window: { showInformationMessage: vi.fn() },
	env: { openExternal: vi.fn(), uriScheme: "vscode" },
	Uri: { parse: vi.fn((uri: string) => ({ toString: () => uri })) },
}))

const fetchMock = vi.fn()
global.fetch = fetchMock

const CLERK = "https://auth.tumblecode.dev"
const KEY = "clerk-auth-credentials"
const STATE = "746573742d72616e646f6d2d6279746573" // hex of "test-random-bytes"
const CREDENTIALS = { clientToken: "client-token", sessionId: "sess-1" }

type Reply = { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; headers: Headers }

const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}): Reply => ({
	ok: status < 400,
	status,
	statusText: `status ${status}`,
	json: async () => body,
	headers: new Headers(headers),
})

const ME = {
	first_name: "Jane",
	last_name: "Smith",
	image_url: "https://example.com/jane.jpg",
	primary_email_address_id: "email-2",
	email_addresses: [
		{ id: "email-1", email_address: "jane.old@example.com" },
		{ id: "email-2", email_address: "jane@example.com" },
	],
}

const membership = (id: string, role = "member") => ({ id: `m-${id}`, role, organization: { id, name: `Org ${id}` } })

describe("WebAuthService", () => {
	let secrets: Map<string, string>
	let secretListener: ((e: { key: string }) => void) | undefined
	let globalState: Map<string, unknown>
	let context: {
		subscriptions: { push: Mock }
		secrets: { get: Mock; store: Mock; delete: Mock; onDidChange: Mock }
		globalState: { get: Mock; update: Mock }
		extension: { packageJSON: { publisher: string; name: string } }
	}
	let timer: { start: Mock; stop: Mock }
	let log: Mock
	/** Replies by URL path; anything not listed is a 500. */
	let routes: Record<string, () => Reply | Promise<Reply>>

	const makeService = () => new WebAuthService(context as unknown as ExtensionContext, log)

	/** A service started with stored credentials: attempting-session. */
	const signedIn = async (credentials: object = CREDENTIALS) => {
		secrets.set(KEY, JSON.stringify(credentials))
		const service = makeService()
		await service.initialize()
		return service
	}

	/** Runs one scheduled refresh, as the refresh timer does. */
	const refresh = (): Promise<boolean> => vi.mocked(RefreshTimer).mock.calls.at(-1)![0].callback()

	const activeSession = async (credentials: object = CREDENTIALS) => {
		const service = await signedIn(credentials)
		const userInfo = new Promise((resolve) => service.once("user-info", resolve))
		await refresh()
		await userInfo
		return service
	}

	const changeSecret = async (key: string) => {
		secretListener!({ key })
		await vi.waitFor(() => expect(context.secrets.get).toHaveBeenCalledTimes(2))
		// Let the credentials handler finish.
		await new Promise((resolve) => setImmediate(resolve))
	}

	const calls = (path: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(path))
	const formOf = (path: string) => new URLSearchParams(calls(path)[0]![1].body)

	beforeEach(() => {
		vi.clearAllMocks()
		secrets = new Map()
		globalState = new Map()
		secretListener = undefined
		context = {
			subscriptions: { push: vi.fn() },
			secrets: {
				get: vi.fn(async (key: string) => secrets.get(key)),
				store: vi.fn(async (key: string, value: string) => void secrets.set(key, value)),
				delete: vi.fn(async (key: string) => void secrets.delete(key)),
				onDidChange: vi.fn((listener: (e: { key: string }) => void) => {
					secretListener = listener
					return { dispose: vi.fn() }
				}),
			},
			globalState: {
				get: vi.fn((key: string) => globalState.get(key)),
				update: vi.fn(async (key: string, value: unknown) => void globalState.set(key, value)),
			},
			extension: { packageJSON: { publisher: "QUB-IT", name: "tumble-code" } },
		}
		timer = { start: vi.fn(), stop: vi.fn() }
		vi.mocked(RefreshTimer).mockImplementation(function () {
			return timer as unknown as RefreshTimer
		})
		vi.mocked(getClerkBaseUrl).mockReturnValue(CLERK)
		vi.mocked(getTumbleCodeApiUrl).mockReturnValue("https://api.test.com")
		vi.mocked(getUserAgent).mockReturnValue("Tumble-Code 1.0.0")
		vi.mocked(crypto.randomBytes).mockReturnValue(Buffer.from("test-random-bytes") as never)
		log = vi.fn()

		routes = {
			"/tokens": () => reply(200, { jwt: "jwt-1" }),
			"/v1/me": () => reply(200, { response: ME }),
			"/organization_memberships": () => reply(200, { response: [membership("org_1")] }),
			"/sign_ins": () =>
				reply(200, { response: { created_session_id: "sess-new" } }, { authorization: "Bearer ct" }),
			"/remove": () => reply(200),
		}
		fetchMock.mockImplementation(async (url: string) => {
			const route = Object.keys(routes).find((path) => url.endsWith(path))
			return route ? routes[route]!() : reply(500)
		})
	})

	describe("initialize", () => {
		it("is logged out without stored credentials", async () => {
			const service = makeService()
			const stateChanged = vi.fn()
			service.on("auth-state-changed", stateChanged)

			await service.initialize()

			expect(stateChanged).toHaveBeenCalledWith({ state: "logged-out", previousState: "initializing" })
			expect(timer.stop).toHaveBeenCalled()
			expect(service.isAuthenticated()).toBe(false)
			expect(service.hasOrIsAcquiringActiveSession()).toBe(false)
			expect(service.getSessionToken()).toBeUndefined()
			expect(service.getUserInfo()).toBeNull()
		})

		it("attempts a session with stored credentials and starts the refresh timer", async () => {
			const service = await signedIn({ ...CREDENTIALS, organizationId: "org_1" })

			expect(service.getState()).toBe("attempting-session")
			expect(timer.start).toHaveBeenCalled()
			expect(service.isAuthenticated()).toBe(true)
			expect(service.hasOrIsAcquiringActiveSession()).toBe(true)
			expect(service.hasActiveSession()).toBe(false)
			expect(service.getSessionToken()).toBeUndefined()
			expect(service.getStoredOrganizationId()).toBe("org_1")
		})

		it.each([
			["unreadable JSON", "invalid-json{", "[auth] Failed to parse stored credentials:"],
			["the wrong shape", JSON.stringify({ invalid: "data" }), "[auth] Invalid credentials format:"],
		])("treats stored credentials with %s as logged out", async (_name, stored, logged) => {
			secrets.set(KEY, stored)
			const service = makeService()

			await service.initialize()

			expect(service.getState()).toBe("logged-out")
			expect(log).toHaveBeenCalledWith(logged, expect.anything())
		})

		it("logs a failing secret store", async () => {
			context.secrets.get.mockRejectedValue(new Error("Storage error"))

			await makeService().initialize()

			expect(log).toHaveBeenCalledWith("[auth] Error handling credentials change:", expect.any(Error))
		})

		it("runs only once", async () => {
			const service = makeService()
			await service.initialize()
			await service.initialize()

			expect(context.secrets.onDidChange).toHaveBeenCalledTimes(1)
			expect(log).toHaveBeenCalledWith("[auth] initialize() called after already initialized")
		})
	})

	describe("credential changes in the secret store", () => {
		it.each([
			[CLERK, KEY, "clerk-auth-credentials-https://other.clerk.com"],
			["https://custom.clerk.com", `${KEY}-https://custom.clerk.com`, KEY],
		])("with Clerk at %s, follows %s only", async (clerkUrl, ownKey, foreignKey) => {
			vi.mocked(getClerkBaseUrl).mockReturnValue(clerkUrl)
			const service = makeService()
			await service.initialize()
			expect(context.secrets.get).toHaveBeenCalledWith(ownKey)
			const stateChanged = vi.fn()
			service.on("auth-state-changed", stateChanged)
			secrets.set(ownKey, JSON.stringify(CREDENTIALS))

			secretListener!({ key: foreignKey })
			await new Promise((resolve) => setImmediate(resolve))
			expect(stateChanged).not.toHaveBeenCalled()

			await changeSecret(ownKey)
			expect(stateChanged).toHaveBeenCalledWith({ state: "attempting-session", previousState: "logged-out" })
		})

		it("restarts the session only when the credentials really changed, and logs out when they go", async () => {
			const service = await signedIn()
			const stateChanged = vi.fn()
			service.on("auth-state-changed", stateChanged)

			secretListener!({ key: KEY })
			await new Promise((resolve) => setImmediate(resolve))
			expect(stateChanged).not.toHaveBeenCalled()

			secrets.set(KEY, JSON.stringify({ ...CREDENTIALS, organizationId: "org_2" }))
			secretListener!({ key: KEY })
			await vi.waitFor(() => expect(stateChanged).toHaveBeenCalledTimes(1))
			expect(service.getStoredOrganizationId()).toBe("org_2")

			secrets.delete(KEY)
			secretListener!({ key: KEY })
			await vi.waitFor(() =>
				expect(stateChanged).toHaveBeenLastCalledWith({
					state: "logged-out",
					previousState: "attempting-session",
				}),
			)
		})
	})

	describe("login", () => {
		it.each([
			[undefined, "vscode%3A%2F%2FQUB-IT.tumble-code"],
			["http://127.0.0.1:53682", "http%3A%2F%2F127.0.0.1%3A53682"],
		])("stores a random state and opens the sign-in page (auth redirect %s)", async (authRedirect, sent) => {
			await makeService().login(authRedirect ? { authRedirect } : undefined)

			expect(crypto.randomBytes).toHaveBeenCalledWith(16)
			expect(globalState.get("clerk-auth-state")).toBe(STATE)
			expect(String(vi.mocked(vscode.env.openExternal).mock.calls[0]![0])).toBe(
				`https://api.test.com/extension/sign-in?state=${STATE}&auth_redirect=${sent}`,
			)
		})

		it.each(["https://evil.example.com", "http://127.0.0.1:53682/auth/clerk/callback", "http://127.0.0.1:80"])(
			"refuses the non-loopback auth redirect %s before storing a state or opening a browser",
			async (authRedirect) => {
				await expect(makeService().login({ authRedirect })).rejects.toThrow("loopback")
				expect(context.globalState.update).not.toHaveBeenCalled()
				expect(vscode.env.openExternal).not.toHaveBeenCalled()
			},
		)

		it("wraps a failure", async () => {
			vi.mocked(crypto.randomBytes).mockImplementation(() => {
				throw new Error("Crypto error")
			})

			await expect(makeService().login()).rejects.toThrow("Failed to initiate Tumble Code Cloud authentication")
			expect(log).toHaveBeenCalledWith("[auth] Error initiating Tumble Code Cloud auth: Error: Crypto error")
		})
	})

	describe("handleCallback", () => {
		beforeEach(() => {
			globalState.set("clerk-auth-state", "valid-state")
		})

		it.each([
			[null, "valid-state"],
			["code", null],
		])("only reports a sign-in URL without code %s or state %s", async (code, state) => {
			await makeService().handleCallback(code, state)

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Invalid Tumble Code Cloud sign in url")
			expect(fetchMock).not.toHaveBeenCalled()
		})

		it.each([
			["org_1", "org_1"],
			[undefined, null],
		])("signs in with the ticket and stores the credentials (organization %s)", async (organizationId, stored) => {
			await makeService().handleCallback("ticket-1", "valid-state", organizationId)

			expect(Object.fromEntries(formOf("/v1/client/sign_ins"))).toEqual({
				strategy: "ticket",
				ticket: "ticket-1",
			})
			expect(JSON.parse(secrets.get(KEY)!)).toEqual({
				clientToken: "Bearer ct",
				sessionId: "sess-new",
				organizationId: stored,
			})
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				"Successfully authenticated with Tumble Code Cloud",
			)
		})

		it.each([
			["a state mismatch", () => globalState.set("clerk-auth-state", "other-state")],
			["a refused ticket", () => (routes["/sign_ins"] = () => reply(400))],
			[
				"no authorization header",
				() => (routes["/sign_ins"] = () => reply(200, { response: { created_session_id: "sess-new" } })),
			],
		])("fails and logs out after %s", async (_name, arrange) => {
			arrange()
			const service = makeService()
			const stateChanged = vi.fn()
			service.on("auth-state-changed", stateChanged)

			await expect(service.handleCallback("ticket-1", "valid-state")).rejects.toThrow(
				"Failed to handle Tumble Code Cloud callback",
			)
			expect(stateChanged).toHaveBeenCalledWith({ state: "logged-out", previousState: "initializing" })
			expect(secrets.has(KEY)).toBe(false)
		})

		it("keeps a signed-in session when the same callback is delivered again", async () => {
			const service = await activeSession()
			const stateChanged = vi.fn()
			service.on("auth-state-changed", stateChanged)
			// The replayed one-time ticket is refused by the server.
			routes["/sign_ins"] = () => reply(401)

			await expect(service.handleCallback("ticket-1", "valid-state")).rejects.toThrow(
				"Failed to handle Tumble Code Cloud callback",
			)
			expect(service.getState()).toBe("active-session")
			expect(service.getSessionToken()).toBe("jwt-1")
			expect(stateChanged).not.toHaveBeenCalled()
			expect(secrets.has(KEY)).toBe(true)
		})
	})

	describe("logout", () => {
		it("removes the credentials and the Clerk session", async () => {
			const service = await signedIn()
			globalState.set("clerk-auth-state", "s")

			await service.logout()

			expect(secrets.has(KEY)).toBe(false)
			expect(globalState.get("clerk-auth-state")).toBeUndefined()
			const [url, options] = calls("/remove")[0]!
			expect(url).toBe(`${CLERK}/v1/client/sessions/sess-1/remove`)
			expect(options.headers.Authorization).toBe("Bearer client-token")
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Logged out from Tumble Code Cloud")
		})

		it.each([
			["without credentials", false, () => {}],
			["when Clerk refuses", true, () => (routes["/remove"] = () => reply(500))],
		])("still logs out %s", async (_name, withCredentials, arrange) => {
			arrange()
			const service = withCredentials ? await signedIn() : makeService()

			await service.logout()

			expect(calls("/remove")).toHaveLength(withCredentials ? 1 : 0)
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Logged out from Tumble Code Cloud")
		})

		it("wraps a failing secret store", async () => {
			context.secrets.delete.mockRejectedValue(new Error("locked"))

			await expect(makeService().logout()).rejects.toThrow("Failed to log out from Tumble Code Cloud")
		})
	})

	describe("session refresh", () => {
		it("creates a session token, becomes active and announces the user once", async () => {
			const service = await signedIn()
			const stateChanged = vi.fn()
			const userInfo = vi.fn()
			service.on("auth-state-changed", stateChanged)
			service.on("user-info", userInfo)

			await refresh()
			await vi.waitFor(() => expect(userInfo).toHaveBeenCalledTimes(1))
			await refresh()

			const [url, options] = calls("/tokens")[0]!
			expect(url).toBe(`${CLERK}/v1/client/sessions/sess-1/tokens`)
			expect(options.headers.Authorization).toBe("Bearer client-token")
			expect(service.getSessionToken()).toBe("jwt-1")
			expect(service.hasActiveSession()).toBe(true)
			expect(stateChanged).toHaveBeenCalledTimes(1)
			expect(stateChanged).toHaveBeenCalledWith({ state: "active-session", previousState: "attempting-session" })
			expect(calls("/v1/me")).toHaveLength(1)
		})

		it.each([
			["an organization", { organizationId: "org_1" }, "org_1"],
			["a personal account", { organizationId: null }, ""],
			["legacy credentials", {}, undefined],
		])("asks for a token in the context of %s", async (_name, extra, sent) => {
			await signedIn({ ...CREDENTIALS, ...extra })

			await refresh()

			const form = formOf("/tokens")
			expect(form.get("_is_native")).toBe("1")
			expect(form.get("organization_id") ?? undefined).toBe(sent)
		})

		it.each([401, 404])("drops the credentials when the client token is refused with %i", async (status) => {
			routes["/tokens"] = () => reply(status)
			await signedIn()

			await expect(refresh()).rejects.toThrow("Invalid/Expired client token")

			expect(secrets.has(KEY)).toBe(false)
			expect(log).toHaveBeenCalledWith("[auth] Invalid/Expired client token: clearing credentials")
		})

		it("does not leave an unhandled rejection when dropping the credentials fails (CB-4)", async () => {
			routes["/tokens"] = () => reply(401)
			await signedIn()
			context.secrets.delete.mockRejectedValueOnce(new Error("Secret storage delete failed"))
			const unhandled: unknown[] = []
			const onUnhandled = (reason: unknown) => unhandled.push(reason)
			process.on("unhandledRejection", onUnhandled)

			try {
				await expect(refresh()).rejects.toThrow("Secret storage delete failed")
				await new Promise((resolve) => setImmediate(resolve))
				expect(unhandled).toHaveLength(0)
			} finally {
				process.off("unhandledRejection", onUnhandled)
			}
		})

		it("goes inactive on the first failed attempt only", async () => {
			routes["/tokens"] = () => reply(500)
			const service = await signedIn()
			const stateChanged = vi.fn()
			service.on("auth-state-changed", stateChanged)

			await expect(refresh()).rejects.toThrow("HTTP 500")
			await expect(refresh()).rejects.toThrow("HTTP 500")

			expect(service.getState()).toBe("inactive-session")
			expect(stateChanged).toHaveBeenCalledTimes(1)
			expect(stateChanged).toHaveBeenCalledWith({
				state: "inactive-session",
				previousState: "attempting-session",
			})
			expect(log).toHaveBeenCalledWith("[auth] Failed to refresh session", expect.any(Error))
		})

		it("does nothing without credentials", async () => {
			const service = makeService()
			await service.initialize()

			await refresh()

			expect(fetchMock).not.toHaveBeenCalled()
		})
	})

	describe("user info", () => {
		const orgFields = (id: string) => ({
			organizationId: id,
			organizationName: `Org ${id}`,
			organizationRole: "member",
			organizationImageUrl: undefined,
		})
		const person = { id: undefined, name: "Jane Smith", email: "jane@example.com", picture: ME.image_url }

		it.each([
			["a personal account", { organizationId: null }, [membership("org_1")], person],
			[
				"an organization member",
				{ organizationId: "org_2" },
				[membership("org_1"), membership("org_2")],
				{ ...person, ...orgFields("org_2") },
			],
			["a stored organization the user left", { organizationId: "org_9" }, [membership("org_1")], person],
			[
				"legacy credentials: the first membership",
				{},
				[membership("org_1"), membership("org_2")],
				{ ...person, ...orgFields("org_1") },
			],
			["legacy credentials without memberships", {}, [], person],
		])("for %s", async (_name, extra, memberships, expected) => {
			routes["/organization_memberships"] = () => reply(200, { response: memberships })

			const service = await activeSession({ ...CREDENTIALS, ...extra })

			expect(service.getUserInfo()).toEqual(expected)
		})

		it("keeps the user when the memberships cannot be read, and fills only the fields Clerk sent", async () => {
			routes["/v1/me"] = () => reply(200, { response: { first_name: "John", last_name: null } })
			routes["/organization_memberships"] = () => reply(500)

			const service = await activeSession({ ...CREDENTIALS, organizationId: "org_1" })

			expect(service.getUserInfo()).toEqual({ id: undefined, name: "John", picture: undefined })
			expect(log).toHaveBeenCalledWith("[auth] Failed to fetch organization info:", expect.any(Error))
		})
	})

	describe("organizations", () => {
		it("switches by storing the credentials with the new organization", async () => {
			const service = await signedIn({ ...CREDENTIALS, organizationId: "org_1" })

			await service.switchOrganization(null)

			expect(JSON.parse(secrets.get(KEY)!)).toEqual({ ...CREDENTIALS, organizationId: null })
		})

		it("refuses to switch while signed out", async () => {
			await expect(makeService().switchOrganization("org_1")).rejects.toThrow("not authenticated")
		})

		it("lists the memberships, or none when signed out or when Clerk fails", async () => {
			expect(await makeService().getOrganizationMemberships()).toEqual([])

			const service = await signedIn()
			expect(await service.getOrganizationMemberships()).toEqual([membership("org_1")])

			routes["/organization_memberships"] = () => reply(503)
			expect(await service.getOrganizationMemberships()).toEqual([])
			expect(log).toHaveBeenCalledWith(expect.stringContaining("Failed to get organization memberships: 503"))
		})
	})
})
