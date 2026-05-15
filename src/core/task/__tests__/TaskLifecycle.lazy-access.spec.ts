// npx vitest run core/task/__tests__/TaskLifecycle.lazy-access.spec.ts

// Regression test for a Task construction ordering bug. Task constructs
// TaskLifecycle on line 567 of Task.ts, but `this.history` and `this.askSay`
// are not assigned until lines 592 and 597. If TaskLifecycle destructures
// `access.history` and `access.askSay` at construction time, those references
// are captured as `undefined` permanently — and every subsequent
// `resumeTaskFromHistory` call crashes with:
//   "Cannot read properties of undefined (reading 'getSavedClineMessages')"
// which leaves an empty broken task in the stack and breaks task resume
// (stop click shows no Resume button, history clicks render no chat).
//
// The fix is to pass the live `access` reference straight through, so
// `history` and `askSay` are looked up at call time.

import { describe, it, expect, vi } from "vitest"

import { TaskLifecycle, type TaskLifecycleAccess } from "../TaskLifecycle"

function buildAccessStub(): TaskLifecycleAccess {
	// Minimal stub of the surface TaskResumption actually touches.
	// `history` and `askSay` are intentionally left undefined to mirror the
	// state of a Task at the moment TaskLifecycle is constructed.
	const access: Partial<TaskLifecycleAccess> = {
		taskId: "task-1",
		instanceId: "inst-1",
		isInitialized: false,
		abort: false,
		abandoned: false,
		abortReason: undefined,
		clineMessages: [],
		apiConversationHistory: [],
		providerRef: { deref: () => undefined } as unknown as TaskLifecycleAccess["providerRef"],
		// history / askSay deliberately omitted
		emit: vi.fn() as unknown as TaskLifecycleAccess["emit"],
		initiateTaskLoop: vi.fn().mockResolvedValue(undefined) as TaskLifecycleAccess["initiateTaskLoop"],
	}
	return access as TaskLifecycleAccess
}

describe("TaskLifecycle / TaskResumption — lazy access lookup", () => {
	it("resolves access.history and access.askSay at call time, not at construction time", async () => {
		const access = buildAccessStub()

		// Construct TaskLifecycle while history/askSay are still undefined,
		// exactly mirroring Task.ts:567 (lifecycle) running before 592 (history)
		// and 597 (askSay).
		const lifecycle = new TaskLifecycle(access)

		const persistedMessages = [
			{ ts: 1, type: "say", say: "user_feedback", text: "hello" },
		] as TaskLifecycleAccess["clineMessages"]

		const getSavedClineMessages = vi.fn().mockResolvedValue(persistedMessages)
		const getSavedApiConversationHistory = vi.fn().mockResolvedValue([{ role: "user", content: "hello" }])
		const overwriteClineMessages = vi.fn().mockImplementation(async (messages: any[]) => {
			access.clineMessages = messages
		})
		const overwriteApiConversationHistory = vi.fn().mockResolvedValue(undefined)

		// Now wire in history/askSay *after* construction. With the bug present
		// TaskResumption already snapshotted `undefined` and these assignments
		// have no effect on what it sees.
		access.history = {
			getSavedClineMessages,
			getSavedApiConversationHistory,
			overwriteClineMessages,
			overwriteApiConversationHistory,
		} as unknown as TaskLifecycleAccess["history"]

		access.askSay = {
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
			say: vi.fn().mockResolvedValue(undefined),
		} as unknown as TaskLifecycleAccess["askSay"]

		await expect(lifecycle.resumeTaskFromHistory()).resolves.toBeUndefined()

		expect(getSavedClineMessages).toHaveBeenCalled()
		expect(overwriteClineMessages).toHaveBeenCalled()
		expect((access.askSay as any).ask).toHaveBeenCalledWith("resume_task")
	})

	it("crashes loudly if history is still missing at call time (sanity check)", async () => {
		const access = buildAccessStub()
		const lifecycle = new TaskLifecycle(access)

		// Deliberately do *not* set access.history. The error we expect here is
		// exactly the production failure mode — proving the test would catch
		// a regression that broke lazy lookup again.
		await expect(lifecycle.resumeTaskFromHistory()).rejects.toThrow(
			/Cannot read properties of undefined.*getSavedClineMessages|undefined is not an object/,
		)
	})
})
