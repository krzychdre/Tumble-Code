import { SaveRecovery } from "../SaveRecovery"

describe("SaveRecovery (the approved-bytes buffer of a diff session)", () => {
	it("starts empty", () => {
		expect(new SaveRecovery().held).toBeUndefined()
	})

	it("holds the last final content until it is discarded", () => {
		const recovery = new SaveRecovery()

		recovery.hold("a.ts", "first")
		recovery.hold("b.ts", "second")
		expect(recovery.held).toEqual({ relPath: "b.ts", newContent: "second" })

		recovery.discard()
		expect(recovery.held).toBeUndefined()
	})

	it("hands out a snapshot, so a later hold() does not change what a running save flushes", () => {
		const recovery = new SaveRecovery()
		recovery.hold("a.ts", "approved")

		const snapshot = recovery.held
		recovery.hold("a.ts", "later")

		expect(snapshot).toEqual({ relPath: "a.ts", newContent: "approved" })
	})
})
