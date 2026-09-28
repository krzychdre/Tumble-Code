// cd src && ./node_modules/.bin/vitest run core/task/__tests__/ignorePartialAskRejection.spec.ts

const { debug } = vi.hoisted(() => ({ debug: vi.fn() }))

vi.mock("../../../utils/logging", () => ({ logger: { debug } }))

import { AskIgnoredError, ignorePartialAskRejection } from "../AskIgnoredError"

describe("ignorePartialAskRejection", () => {
	beforeEach(() => {
		debug.mockClear()
	})

	it("swallows a superseded partial ask without logging", () => {
		expect(() => ignorePartialAskRejection(new AskIgnoredError("new partial"))).not.toThrow()
		expect(debug).not.toHaveBeenCalled()
	})

	it("swallows any other rejection and logs it at debug", () => {
		expect(() => ignorePartialAskRejection(new Error("task t.1 aborted"))).not.toThrow()
		expect(debug).toHaveBeenCalledWith("[ask] partial update rejected: task t.1 aborted")
	})

	it("keeps a tool's partial ask from rejecting", async () => {
		await expect(Promise.reject(new AskIgnoredError()).catch(ignorePartialAskRejection)).resolves.toBeUndefined()
	})
})
