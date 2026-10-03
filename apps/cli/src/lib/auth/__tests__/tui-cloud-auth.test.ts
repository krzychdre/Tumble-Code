import { EventEmitter } from "events"

import type { ExtensionMessage, WebviewMessage } from "@tumble-code/types"

import { TuiCloudAuth, type CloudAuthChannel } from "../tui-cloud-auth.js"

type Answer = (message: WebviewMessage, emit: { url(url: string): void; message(m: ExtensionMessage): void }) => void

/** The running extension, scripted: `answer` sees every message the CLI sends. */
function fakeExtension(answer: Answer = () => {}) {
	const events = new EventEmitter()
	const sent: WebviewMessage[] = []
	const emit = {
		url: (url: string) => setTimeout(() => events.emit("url", url), 0),
		message: (message: ExtensionMessage) => setTimeout(() => events.emit("message", message), 0),
	}
	const channel: CloudAuthChannel = {
		send: (message) => {
			sent.push(message)
			answer(message, emit)
		},
		onMessage: (listener) => {
			events.on("message", listener)
			return () => events.off("message", listener)
		},
		onOpenExternal: (listener) => {
			events.on("url", listener)
			return () => events.off("url", listener)
		},
	}
	return { channel, sent, events }
}

const result = (text: string, success: boolean, error?: string): ExtensionMessage => ({
	type: "cloudAuthResult",
	text,
	success,
	...(error ? { error } : {}),
})

/**
 * A signed-in round trip: the extension "opens" the sign-in page, a browser
 * comes back to the CLI's listener, and the ticket exchange answers `exchange`.
 */
function signInExtension(exchange: ExtensionMessage = result("rooCloudManualUrl", true)) {
	const browserPages: Promise<{ status: number; body: string }>[] = []

	const extension = fakeExtension((message, emit) => {
		if (message.type === "rooCloudSignIn") {
			emit.url(`http://cloud.test/extension/sign-in?state=s1&auth_redirect=${message.authRedirect}`)
			// The browser, after the user signed in.
			setTimeout(() => {
				browserPages.push(
					fetch(`${message.authRedirect}/auth/clerk/callback?code=ticket&state=s1`).then(
						async (response) => ({
							status: response.status,
							body: await response.text(),
						}),
					),
				)
			}, 10)
		}

		if (message.type === "rooCloudManualUrl") {
			emit.message(exchange)
		}
	})

	return { ...extension, browserPages }
}

function setup(channel: CloudAuthChannel, overrides: Partial<ConstructorParameters<typeof TuiCloudAuth>[0]> = {}) {
	const notes: string[] = []
	const auth = new TuiCloudAuth({
		channel,
		note: (text) => notes.push(text),
		loadSettings: async () => ({ cloudApiUrl: "http://cloud.test" }),
		env: {},
		...overrides,
	})
	return { auth, notes }
}

describe("TuiCloudAuth /login", () => {
	it("signs in through the browser and the loopback listener", async () => {
		const extension = signInExtension()
		const { auth, notes } = setup(extension.channel)

		await auth.login("")

		const signIn = extension.sent[0]
		expect(signIn).toMatchObject({ type: "rooCloudSignIn" })
		expect(signIn?.authRedirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
		expect(extension.sent[1]).toEqual({
			type: "rooCloudManualUrl",
			text: `${signIn?.authRedirect}/auth/clerk/callback?code=ticket&state=s1`,
		})
		expect(notes[0]).toBe("Signing in to Tumble Code Cloud at http://cloud.test")
		expect(notes[1]).toContain("type: /login <callback-url>")
		expect(notes.at(-1)).toContain("Signed in to Tumble Code Cloud.")
		const page = await extension.browserPages[0]
		expect(page?.status).toBe(200)
		expect(page?.body).toContain("You can close this tab")
	})

	it("shows a failed ticket exchange in the transcript and on the browser page", async () => {
		const extension = signInExtension(result("rooCloudManualUrl", false, "Invalid state parameter"))
		const { auth, notes } = setup(extension.channel)

		await auth.login("")

		expect(notes.at(-1)).toBe("Tumble Code Cloud sign-in failed: Invalid state parameter")
		const page = await extension.browserPages[0]
		expect(page?.status).toBe(500)
		expect(page?.body).toContain("Invalid state parameter")
	})

	it("shows a sign-in the extension could not start", async () => {
		const extension = fakeExtension((message, emit) => {
			if (message.type === "rooCloudSignIn") {
				emit.message(result("rooCloudSignIn", false, "CloudService not initialized"))
			}
		})
		const { auth, notes } = setup(extension.channel)

		await auth.login("")

		expect(notes.at(-1)).toBe("Tumble Code Cloud sign-in failed: CloudService not initialized")
	})

	it("explains how to configure the cloud and sends nothing without a cloud URL", async () => {
		const extension = fakeExtension()
		const { auth, notes } = setup(extension.channel, { loadSettings: async () => ({}) })

		await auth.login("")

		expect(extension.sent).toEqual([])
		expect(notes[0]).toContain('Add "cloudApiUrl" to')
	})

	it("reports a browser that never comes back", async () => {
		const extension = fakeExtension()
		const { auth, notes } = setup(extension.channel, { loginTimeoutMs: 30 })

		await auth.login("")

		expect(notes.at(-1)).toBe("Tumble Code Cloud sign-in failed: no sign-in arrived within 0 minutes")
	})

	it("completes with a pasted address, ending the waiting browser sign-in silently", async () => {
		const extension = fakeExtension((message, emit) => {
			if (message.type === "rooCloudManualUrl") {
				emit.message(result("rooCloudManualUrl", true))
			}
		})
		const { auth, notes } = setup(extension.channel)

		const waiting = auth.login("")
		await vi.waitFor(() => expect(extension.sent[0]?.type).toBe("rooCloudSignIn"))
		const pasted = "http://127.0.0.1:53682/auth/clerk/callback?code=t2&state=s1"
		await auth.login(pasted)
		await waiting

		expect(extension.sent.at(-1)).toEqual({ type: "rooCloudManualUrl", text: pasted })
		expect(notes.filter((note) => note.includes("failed"))).toEqual([])
		expect(notes.at(-1)).toContain("Signed in to Tumble Code Cloud.")
	})

	it("answers anything else after /login with the usage", async () => {
		const extension = fakeExtension()
		const { auth, notes } = setup(extension.channel)

		await auth.login("please")

		expect(extension.sent).toEqual([])
		expect(notes[0]).toContain("Usage: /login")
	})

	it("explains that the cloud server address goes in the settings, not after /login", async () => {
		const extension = fakeExtension()
		const { auth, notes } = setup(extension.channel)

		await auth.login("http://localhost:8085/")

		expect(extension.sent).toEqual([])
		expect(notes[0]).toContain("http://localhost:8085 looks like the cloud server address")
		expect(notes[0]).toContain('{ "cloudApiUrl": "http://localhost:8085" }')
		expect(notes[0]).not.toContain("Usage:")
	})

	it("reports an extension that never answers the exchange", async () => {
		const extension = fakeExtension()
		const { auth, notes } = setup(extension.channel, { resultTimeoutMs: 20 })

		await auth.login("http://127.0.0.1:53682/auth/clerk/callback?code=t&state=s")

		expect(notes.at(-1)).toBe("Tumble Code Cloud sign-in failed: the extension did not answer within 0.02 s")
	})
})

describe("TuiCloudAuth /logout", () => {
	it("reports success and failure", async () => {
		let succeed = true
		const extension = fakeExtension((message, emit) => {
			if (message.type === "rooCloudSignOut") {
				emit.message(result("rooCloudSignOut", succeed, succeed ? undefined : "disk full"))
			}
		})
		const { auth, notes } = setup(extension.channel)

		await auth.logout()
		succeed = false
		await auth.logout()

		expect(notes).toEqual(["Signed out from Tumble Code Cloud.", "Tumble Code Cloud sign-out failed: disk full"])
		expect(extension.events.listenerCount("message")).toBe(0)
	})
})
