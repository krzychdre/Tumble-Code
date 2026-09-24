// npx vitest run src/__tests__/public-api-no-ipc.spec.ts

// The external IPC socket (packages/ipc and the IPC server in
// src/extension/api.ts) was removed in PR #252. These checks keep the types
// package from carrying its message types and its IPC-only query-response
// events, which nothing sends any more.

import * as types from "../index.js"
import { RooCodeEventName, rooCodeEventsSchema, taskEventSchema } from "../index.js"

describe("@roo-code/types public API without the IPC socket", () => {
	it.each(["IpcMessageType", "IpcOrigin", "ackSchema", "TaskCommandName", "taskCommandSchema", "ipcMessageSchema"])(
		"does not export the IPC runtime value %s",
		(name) => {
			expect(Object.keys(types)).not.toContain(name)
		},
	)

	it.each(["commandsResponse", "modesResponse", "modelsResponse"])(
		"has no IPC-only query-response event %s",
		(eventName) => {
			expect(Object.values(RooCodeEventName)).not.toContain(eventName)
			expect(Object.keys(rooCodeEventsSchema.shape)).not.toContain(eventName)
			expect(taskEventSchema.safeParse({ eventName, payload: [[]] }).success).toBe(false)
		},
	)

	it("keeps the events the extension API still emits", () => {
		expect(RooCodeEventName.TaskCreated).toBe("taskCreated")
		expect(RooCodeEventName.TaskCompleted).toBe("taskCompleted")
		expect(RooCodeEventName.ProviderProfileChanged).toBe("providerProfileChanged")
		expect(RooCodeEventName.EvalPass).toBe("evalPass")
	})
})
