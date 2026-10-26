// The recall scope cache: how often the cloud is asked, and what the tool gate sees between asks.
// The lookup (the cloud's GET /api/recall/context) and the clock are the boundary.

import type { RecallScope } from "@tumble-code/cloud"

import { RECALL_SCOPE_TTL_MS, RecallScopeCache } from "../recallScope"

const ANN = { userId: "user-ann", organizationId: null }

let now: number
let lookup: ReturnType<typeof vi.fn<(cwd: string) => Promise<RecallScope>>>
let cache: RecallScopeCache

beforeEach(() => {
	now = 1_000_000
	lookup = vi.fn(async (_cwd: string): Promise<RecallScope> => "members")
	cache = new RecallScopeCache(lookup, () => now)
})

describe("RecallScopeCache", () => {
	it("asks the cloud once per folder within five minutes, then again", async () => {
		expect(await cache.scopeFor(ANN, "/work/tool")).toBe("members")
		now += RECALL_SCOPE_TTL_MS - 1
		expect(await cache.scopeFor(ANN, "/work/tool")).toBe("members")
		expect(lookup).toHaveBeenCalledTimes(1)

		lookup.mockResolvedValueOnce("none")
		now += 1
		expect(await cache.scopeFor(ANN, "/work/tool")).toBe("none")
		expect(lookup).toHaveBeenCalledTimes(2)
	})

	it("shares one question between requests that overlap", async () => {
		const both = await Promise.all([cache.scopeFor(ANN, "/work/tool"), cache.scopeFor(ANN, "/work/tool")])

		expect(both).toEqual(["members", "members"])
		expect(lookup).toHaveBeenCalledTimes(1)
	})

	it("asks separately for another folder and for another organization", async () => {
		await cache.scopeFor(ANN, "/work/tool")
		await cache.scopeFor(ANN, "/work/notes")
		await cache.scopeFor({ ...ANN, organizationId: "org_1" }, "/work/tool")

		expect(lookup.mock.calls).toEqual([["/work/tool"], ["/work/notes"], ["/work/tool"]])
	})

	it("answers undefined when signed out, without asking, even with a cached scope", async () => {
		await cache.scopeFor(ANN, "/work/tool")

		expect(await cache.scopeFor(undefined, "/work/tool")).toBeUndefined()
		expect(lookup).toHaveBeenCalledTimes(1)
	})

	it("remembers a failed question as undefined until it expires", async () => {
		lookup.mockRejectedValueOnce(new Error("fetch failed"))

		expect(await cache.scopeFor(ANN, "/work/tool")).toBeUndefined()
		expect(await cache.scopeFor(ANN, "/work/tool")).toBeUndefined()
		expect(lookup).toHaveBeenCalledTimes(1)

		now += RECALL_SCOPE_TTL_MS
		expect(await cache.scopeFor(ANN, "/work/tool")).toBe("members")
	})
})
