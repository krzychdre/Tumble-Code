// cd src && npx vitest run utils/__tests__/perfCounters.spec.ts

import { perfCounters, diffPerfCounters, formatPerfCounters, jsonByteLength } from "../perfCounters"

describe("perfCounters", () => {
	beforeEach(() => {
		perfCounters.reset()
		perfCounters.setEnabled(false)
	})

	afterAll(() => {
		perfCounters.reset()
		perfCounters.setEnabled(false)
	})

	it("counts nothing while disabled", () => {
		perfCounters.add("getState")
		perfCounters.recordWebviewPost({ type: "state", state: { clineMessages: [{}, {}] } })
		perfCounters.recordSave("uiMessages", [{ ts: 1 }])

		expect(Object.values(perfCounters.snapshot()).every((value) => value === 0)).toBe(true)
	})

	it("counts calls and sizes by kind while enabled", () => {
		perfCounters.setEnabled(true)

		perfCounters.add("getState")
		perfCounters.add("getState")
		const state = { type: "state", state: { clineMessages: [{ ts: 1 }, { ts: 2 }] } }
		perfCounters.recordWebviewPost(state)
		const updated = { type: "messageUpdated", clineMessage: { ts: 2, text: "héllo" } }
		perfCounters.recordWebviewPost(updated)
		const added = { type: "messageAdded", clineMessage: { ts: 3 }, messageIndex: 0 }
		perfCounters.recordWebviewPost(added)
		perfCounters.recordWebviewPost({ type: "action" })
		perfCounters.recordSave("uiMessages", [{ ts: 1 }])
		perfCounters.recordSave("apiHistory", [{ role: "user" }])

		const values = perfCounters.snapshot()
		expect(values.getState).toBe(2)
		expect(values.statePosts).toBe(1)
		expect(values.statePostMessages).toBe(2)
		expect(values.statePostBytes).toBe(Buffer.byteLength(JSON.stringify(state)))
		expect(values.messageUpdatedPosts).toBe(1)
		// UTF-8 bytes, not UTF-16 code units: "é" is two bytes.
		expect(values.messageUpdatedBytes).toBe(JSON.stringify(updated).length + 1)
		expect(values.messageAddedPosts).toBe(1)
		expect(values.messageAddedBytes).toBe(Buffer.byteLength(JSON.stringify(added)))
		expect(values.otherPosts).toBe(1)
		expect(values.uiMessagesSaves).toBe(1)
		expect(values.uiMessagesSaveBytes).toBe(JSON.stringify([{ ts: 1 }]).length)
		expect(values.apiHistorySaves).toBe(1)
	})

	it("reports the difference between two snapshots, non-zero counters only", () => {
		perfCounters.setEnabled(true)
		perfCounters.add("getState")
		const before = perfCounters.snapshot()
		perfCounters.add("getState", 3)
		perfCounters.add("uiMessagesSaves")

		const delta = diffPerfCounters(before, perfCounters.snapshot())

		expect(delta.getState).toBe(3)
		expect(formatPerfCounters(delta)).toBe("getState=3 uiMessagesSaves=1")
		expect(formatPerfCounters(diffPerfCounters(before, before))).toBe("no counted work")
	})

	it("measures unserializable values as zero instead of throwing", () => {
		const cyclic: Record<string, unknown> = {}
		cyclic.self = cyclic

		expect(jsonByteLength(cyclic)).toBe(0)
		expect(jsonByteLength(undefined)).toBe(0)
	})
})
