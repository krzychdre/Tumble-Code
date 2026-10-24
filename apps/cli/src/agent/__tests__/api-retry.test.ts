import type { ClineMessage } from "@tumble-code/types"

import { describeApiRetry, UnattendedRetryCap } from "../api-retry.js"

const refused = "OpenAI completion error: Connection error. (connect ECONNREFUSED 127.0.0.1:59999)\n"

const say = (ts: number, kind: ClineMessage["say"], text = ""): ClineMessage => ({ ts, type: "say", say: kind, text })
const retry = (ts: number, text = `${refused}<retry_timer>5</retry_timer>`) => say(ts, "api_req_retry_delayed", text)

describe("describeApiRetry", () => {
	it.each([
		[`${refused}<retry_timer>5</retry_timer>`, `API request failed: ${refused.trim()} - retrying in 5 s`],
		[refused, `API request failed: ${refused.trim()} - retrying now`],
		[
			"503\nService Unavailable\n<retry_timer>20</retry_timer>",
			"API request failed: 503 Service Unavailable - retrying in 20 s",
		],
	])("reads %j", (text, expected) => {
		expect(describeApiRetry(text)).toBe(expected)
	})
})

describe("UnattendedRetryCap", () => {
	/** The failures the cap reports for the messages, in order. */
	const observeAll = (cap: UnattendedRetryCap, messages: ClineMessage[]) =>
		messages.map((message) => cap.observe(message)).filter(Boolean)

	it("fails at the 7th failed attempt of one request, counting each retry message once", () => {
		const cap = new UnattendedRetryCap()
		const retries = [2, 3, 4, 5, 6, 7].flatMap((ts) => [retry(ts), retry(ts, refused)])

		expect(observeAll(cap, [say(1, "api_req_started"), ...retries])).toEqual([])
		expect(cap.observe(retry(8))).toBe(`API request failed after 7 attempts: ${refused.trim()}`)
	})

	it("starts counting again at a new request and never counts a 429", () => {
		const cap = new UnattendedRetryCap()
		const rateLimited = [2, 3, 4, 5, 6, 7, 8].map((ts) =>
			retry(ts, "429\nToo Many Requests\n<retry_timer>5</retry_timer>"),
		)
		const firstRequest = [10, 11, 12, 13, 14, 15].map((ts) => retry(ts))
		const secondRequest = [21, 22, 23, 24, 25, 26].map((ts) => retry(ts))

		expect(
			observeAll(cap, [
				say(1, "api_req_started"),
				...rateLimited,
				...firstRequest,
				say(20, "api_req_started"),
				// An older message changed again (a price written into it) is no new request.
				say(1, "api_req_started"),
				...secondRequest,
			]),
		).toEqual([])
		expect(cap.observe(retry(27))).toBe(`API request failed after 7 attempts: ${refused.trim()}`)
	})
})
