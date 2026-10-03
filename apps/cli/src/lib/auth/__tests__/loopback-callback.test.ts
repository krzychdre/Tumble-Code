import { PassThrough } from "stream"

import {
	parseCloudCallbackUrl,
	startLoopbackListener,
	waitForPastedCallback,
	type LoopbackListener,
} from "../loopback-callback.js"

/** A real request to the listener on 127.0.0.1 (fetch never follows anything here). */
async function get(listener: LoopbackListener, pathAndQuery: string, method = "GET") {
	const response = await fetch(`${listener.redirectUrl}${pathAndQuery}`, { method })
	return { status: response.status, body: await response.text() }
}

describe("parseCloudCallbackUrl", () => {
	it("reads code, state and organization from a loopback callback", () => {
		expect(
			parseCloudCallbackUrl(
				"  http://127.0.0.1:53682/auth/clerk/callback?code=t1&state=s1&organizationId=org_1 ",
			),
		).toEqual({
			code: "t1",
			state: "s1",
			organizationId: "org_1",
			url: "http://127.0.0.1:53682/auth/clerk/callback?code=t1&state=s1&organizationId=org_1",
		})
	})

	it('treats a missing or "null" organization as a personal account', () => {
		expect(parseCloudCallbackUrl("http://localhost:2000/auth/clerk/callback?code=t&state=s")?.organizationId).toBe(
			null,
		)
		expect(
			parseCloudCallbackUrl("http://localhost:2000/auth/clerk/callback?code=t&state=s&organizationId=null")
				?.organizationId,
		).toBe(null)
	})

	it.each([
		"not a url",
		"http://127.0.0.1:53682/other?code=t&state=s",
		"http://127.0.0.1:53682/auth/clerk/callback?code=t",
		"http://127.0.0.1:53682/auth/clerk/callback?state=s",
	])("rejects %s", (text) => {
		expect(parseCloudCallbackUrl(text)).toBeUndefined()
	})
})

describe("startLoopbackListener", () => {
	let listener: LoopbackListener | undefined

	afterEach(() => {
		listener?.close()
		listener = undefined
	})

	it("listens on 127.0.0.1 with an OS-chosen port", async () => {
		listener = await startLoopbackListener()

		expect(listener.redirectUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
	})

	it("passes code and state through and holds the browser until the result is known", async () => {
		listener = await startLoopbackListener()
		const browser = get(listener, "/auth/clerk/callback?code=ticket-1&state=state-1")

		const callback = await listener.callback
		expect(callback).toMatchObject({ code: "ticket-1", state: "state-1", organizationId: null })
		expect(callback.url).toBe(`${listener.redirectUrl}/auth/clerk/callback?code=ticket-1&state=state-1`)

		callback.reply({ ok: true })
		const page = await browser
		expect(page.status).toBe(200)
		expect(page.body).toContain("You can close this tab and return to the terminal.")
	})

	it("shows a failed sign-in on the page, escaped", async () => {
		listener = await startLoopbackListener()
		const browser = get(listener, "/auth/clerk/callback?code=t&state=s")

		;(await listener.callback).reply({ ok: false, error: "HTTP 400 <bad ticket>" })

		const page = await browser
		expect(page.status).toBe(500)
		expect(page.body).toContain("HTTP 400 &#60;bad ticket&#62;")
	})

	it("answers a neutral page when the result takes too long", async () => {
		listener = await startLoopbackListener({ replyTimeoutMs: 20 })
		const browser = get(listener, "/auth/clerk/callback?code=t&state=s")
		await listener.callback

		const page = await browser
		expect(page.status).toBe(200)
		expect(page.body).toContain("Return to the terminal to see the result.")
	})

	it("answers 404 for any other path and 405 for other methods, and keeps waiting", async () => {
		listener = await startLoopbackListener()

		expect((await get(listener, "/")).status).toBe(404)
		expect((await get(listener, "/favicon.ico")).status).toBe(404)
		expect((await get(listener, "/auth/clerk/callback?code=t&state=s", "POST")).status).toBe(405)

		const browser = get(listener, "/auth/clerk/callback?code=t&state=s")
		;(await listener.callback).reply({ ok: true })
		expect((await browser).status).toBe(200)
	})

	it("refuses a callback without code or state, and one with another state once the state is known", async () => {
		listener = await startLoopbackListener()
		listener.expectState("expected")

		expect((await get(listener, "/auth/clerk/callback?code=t")).status).toBe(400)
		const stray = await get(listener, "/auth/clerk/callback?code=t&state=forged")
		expect(stray.status).toBe(400)
		expect(stray.body).toContain("does not belong to the sign-in started in the terminal")

		const browser = get(listener, "/auth/clerk/callback?code=t&state=expected")
		expect((await listener.callback).state).toBe("expected")
		;(await listener.callback).reply({ ok: true })
		expect((await browser).status).toBe(200)
	})

	it("accepts only the first callback", async () => {
		listener = await startLoopbackListener({ replyTimeoutMs: 20 })
		const first = get(listener, "/auth/clerk/callback?code=t&state=s")
		await listener.callback

		expect((await get(listener, "/auth/clerk/callback?code=t2&state=s")).status).toBe(409)
		await first
	})

	it("rejects after the timeout and stops listening", async () => {
		listener = await startLoopbackListener({ timeoutMs: 30 })

		await expect(listener.callback).rejects.toThrow("no sign-in arrived")
		await expect(fetch(`${listener.redirectUrl}/auth/clerk/callback?code=t&state=s`)).rejects.toThrow()
	})

	it("rejects when the signal aborts (Ctrl+C)", async () => {
		const controller = new AbortController()
		listener = await startLoopbackListener({ signal: controller.signal })

		controller.abort()

		await expect(listener.callback).rejects.toThrow("sign-in cancelled")
	})
})

describe("waitForPastedCallback", () => {
	it("resolves with the first pasted callback URL and reports other lines", async () => {
		const input = new PassThrough()
		const onInvalidLine = vi.fn()
		const pasted = waitForPastedCallback({ input, onInvalidLine })

		input.write("\n")
		input.write("hello\n")
		input.write("http://127.0.0.1:53682/auth/clerk/callback?code=t&state=s\n")

		await expect(pasted).resolves.toMatchObject({ code: "t", state: "s" })
		expect(onInvalidLine).toHaveBeenCalledTimes(1)
		expect(onInvalidLine).toHaveBeenCalledWith("hello")
	})

	it("rejects when the signal aborts", async () => {
		const controller = new AbortController()
		const pasted = waitForPastedCallback({ input: new PassThrough(), signal: controller.signal })

		controller.abort()

		await expect(pasted).rejects.toThrow("sign-in cancelled")
	})
})
