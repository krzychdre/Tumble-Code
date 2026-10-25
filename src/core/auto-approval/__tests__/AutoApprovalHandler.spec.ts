// AutoApprovalHandler on real api_req_started messages and the real cost totals
// (consolidateTokenUsage); only the approval ask is a stand-in.

import type { ClineMessage, GlobalState } from "@tumble-code/types"

import { AutoApprovalHandler } from "../AutoApprovalHandler"

const request = (cost = 0): ClineMessage => ({
	type: "say",
	say: "api_req_started",
	text: JSON.stringify({ cost }),
	ts: Date.now(),
})
const requests = (...costs: number[]) => costs.map(request)

function setup(limits: Partial<GlobalState>, answer = "yesButtonClicked") {
	const ask = vi.fn().mockResolvedValue({ response: answer })
	const handler = new AutoApprovalHandler()
	const check = (messages: ClineMessage[]) => handler.checkAutoApprovalLimits(limits as GlobalState, messages, ask)
	return { ask, check }
}

const proceed = { shouldProceed: true, requiresApproval: false }

describe("AutoApprovalHandler", () => {
	it("lets every request through without limits", async () => {
		const { ask, check } = setup({})

		await expect(check(requests(100, 100, 100))).resolves.toEqual(proceed)
		expect(ask).not.toHaveBeenCalled()
	})

	it.each([
		[2, 1, false],
		[2, 2, true],
	])("with %i allowed requests and %i made, asks before the next one: %s", async (max, made, asks) => {
		const { ask, check } = setup({ allowedMaxRequests: max })

		const result = await check(requests(...Array(made).fill(0)))

		expect(ask.mock.calls).toEqual(
			asks ? [["auto_approval_max_req_reached", JSON.stringify({ count: max, type: "requests" })]] : [],
		)
		expect(result).toEqual(
			asks
				? { shouldProceed: true, requiresApproval: true, approvalType: "requests", approvalCount: max }
				: proceed,
		)
	})

	it.each([
		[5, [2, 3], false],
		// The total is compared with a small tolerance for float sums.
		[5, [2.00004, 3.00005], false],
		[5, [2, 3.001], true],
	])("with a cost limit of %d and costs %j asks: %s", async (max, costs, asks) => {
		const { ask, check } = setup({ allowedMaxCost: max })

		const result = await check(requests(...costs))

		expect(ask.mock.calls).toEqual(
			asks ? [["auto_approval_max_req_reached", JSON.stringify({ count: "5.00", type: "cost" })]] : [],
		)
		expect(result.requiresApproval).toBe(asks)
	})

	it("asks about the request limit first", async () => {
		const { ask, check } = setup({ allowedMaxRequests: 1, allowedMaxCost: 1 })

		const result = await check(requests(10))

		expect(ask).toHaveBeenCalledTimes(1)
		expect(result.approvalType).toBe("requests")
	})

	it.each([
		["requests", { allowedMaxRequests: 1 }, [0], 1],
		["cost", { allowedMaxCost: 1 }, [2], "1.00"],
	])("stops when the user refuses more %s", async (type, limits, costs, count) => {
		const { check } = setup(limits, "noButtonClicked")

		await expect(check(requests(...costs))).resolves.toEqual({
			shouldProceed: false,
			requiresApproval: true,
			approvalType: type,
			approvalCount: count,
		})
	})

	it.each([
		["requests", { allowedMaxRequests: 2 }, [0, 0], [0], [0, 0]],
		["cost", { allowedMaxCost: 5 }, [3, 3], [2, 2], [2]],
	])("counts %s again from the approval on", async (_, limits, before, under, over) => {
		const { ask, check } = setup(limits)
		const messages = requests(...before)

		expect((await check(messages)).requiresApproval).toBe(true)
		messages.push(...requests(...under))
		expect((await check(messages)).requiresApproval).toBe(false)
		messages.push(...requests(...over))
		expect((await check(messages)).requiresApproval).toBe(true)
		expect(ask).toHaveBeenCalledTimes(2)
	})
})
