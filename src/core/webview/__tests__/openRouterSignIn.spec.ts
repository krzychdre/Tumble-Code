// npx vitest run core/webview/__tests__/openRouterSignIn.spec.ts
// A local HTTP server stands in for OpenRouter's key endpoint.

import { createHash } from "crypto"
import { createServer, type Server } from "http"
import type { AddressInfo } from "net"

import axios from "axios"

import { allowNetConnect } from "../../../vitest.setup"

import { completeOpenRouterSignIn, startOpenRouterSignIn, takePendingOpenRouterSignIn } from "../openRouterSignIn"

const post = (url: string, body: Record<string, string>) => axios.post(url, body)

describe("OpenRouter sign-in", () => {
	let server: Server
	let baseUrl: string
	const received: Record<string, string>[] = []

	beforeAll(async () => {
		allowNetConnect("127.0.0.1")
		server = createServer((req, res) => {
			let raw = ""
			req.on("data", (chunk) => (raw += chunk))
			req.on("end", () => {
				received.push(JSON.parse(raw))
				res.setHeader("Content-Type", "application/json")
				res.end(JSON.stringify({ key: "sk-or-new" }))
			})
		})
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
		baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`
	})

	afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

	beforeEach(() => {
		received.length = 0
		takePendingOpenRouterSignIn()
	})

	it("ignores a callback when no sign-in was started in this window, and calls nothing", async () => {
		await expect(completeOpenRouterSignIn("attacker-code", baseUrl, post)).resolves.toBeUndefined()
		expect(received).toEqual([])
	})

	it("exchanges the code with the verifier of the sign-in it started, once", async () => {
		const page = new URL(startOpenRouterSignIn("vscode://pub.ext/openrouter"))
		expect(page.origin + page.pathname).toBe("https://openrouter.ai/auth")
		expect(page.searchParams.get("callback_url")).toBe("vscode://pub.ext/openrouter")
		expect(page.searchParams.get("code_challenge_method")).toBe("S256")

		await expect(completeOpenRouterSignIn("code-1", baseUrl, post)).resolves.toBe("sk-or-new")

		expect(received).toHaveLength(1)
		const { code, code_verifier, code_challenge_method } = received[0]!
		expect(code).toBe("code-1")
		expect(code_challenge_method).toBe("S256")
		const challenge = createHash("sha256").update(code_verifier!).digest("base64url")
		expect(page.searchParams.get("code_challenge")).toBe(challenge)

		// A second callback (a replayed or planted link) finds nothing pending.
		await expect(completeOpenRouterSignIn("code-2", baseUrl, post)).resolves.toBeUndefined()
		expect(received).toHaveLength(1)
	})

	it("lets a started sign-in expire after ten minutes", async () => {
		const started = Date.now()
		startOpenRouterSignIn("vscode://pub.ext/openrouter", started)

		await expect(
			completeOpenRouterSignIn("late", baseUrl, post, started + 10 * 60 * 1000 + 1),
		).resolves.toBeUndefined()
		expect(received).toEqual([])
	})
})
