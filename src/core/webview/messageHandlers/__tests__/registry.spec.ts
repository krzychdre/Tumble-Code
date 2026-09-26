// The routing table is assembled from domain modules with a plain object
// merge, so a type claimed by two modules would silently lose one handler.
// This spec guards the assembly; webviewMessageHandler.routing.spec.ts guards
// what each handler does.

vi.mock("vscode", () => ({}))
vi.mock("../../ClineProvider", () => ({ ClineProvider: class {} }))

import { messageHandlerGroups, messageHandlers } from "../index"

describe("message handler registry", () => {
	it("gives every message type to exactly one domain module", () => {
		const owners = new Map<string, string[]>()
		for (const [group, handlers] of Object.entries(messageHandlerGroups)) {
			for (const type of Object.keys(handlers)) {
				owners.set(type, [...(owners.get(type) ?? []), group])
			}
		}
		const claimedTwice = [...owners].filter(([, groups]) => groups.length > 1)
		expect(claimedTwice).toEqual([])
	})

	it("routes the 137 message types the old switch handled plus resyncClineMessages, each to a function", () => {
		const entries = Object.entries(messageHandlers)
		expect(entries).toHaveLength(138)
		for (const [, handler] of entries) {
			expect(typeof handler).toBe("function")
		}
	})

	it("shares one handler between the two debug history types", () => {
		expect(messageHandlers.openDebugApiHistory).toBe(messageHandlers.openDebugUiHistory)
	})
})
