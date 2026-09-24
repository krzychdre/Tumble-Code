// Compile-time contract between Task and the narrow access interfaces its
// helper modules (TaskHistory, TaskApiLoop, ...) are built with.
//
// Task passes `this` to each helper. Before CORE-R5 every call site used
// `this as unknown as XAccess`, a double cast that silenced real mismatches
// (for example a field that was private on Task but required by the
// interface). The assignments below are checked by `tsc --noEmit` in src
// (tsconfig includes every .ts file), so a Task that stops satisfying one of
// the interfaces fails the type check instead of drifting silently.

import type { Task } from "../Task"
import type { TaskApiLoopAccess } from "../TaskApiLoop"
import type { TaskAskSayAccess } from "../TaskAskSay"
import type { TaskContextManagerAccess } from "../TaskContextManager"
import type { TaskHistoryAccess } from "../TaskHistory"
import type { TaskLifecycleAccess } from "../TaskLifecycle"
import type { TaskStreamProcessorAccess } from "../TaskStreamProcessor"
import type { TaskSubtasksAccess } from "../TaskSubtasks"
import type { TaskTokenTrackingAccess } from "../TaskTokenTracking"

// Never called: the body exists only so tsc checks each assignment.
function assertTaskSatisfiesAccessInterfaces(task: Task) {
	const lifecycle: TaskLifecycleAccess = task
	const tokenTracking: TaskTokenTrackingAccess = task
	const history: TaskHistoryAccess = task
	const askSay: TaskAskSayAccess = task
	const streamProcessor: TaskStreamProcessorAccess = task
	const contextManager: TaskContextManagerAccess = task
	const subtasks: TaskSubtasksAccess = task
	const apiLoop: TaskApiLoopAccess = task
	return [lifecycle, tokenTracking, history, askSay, streamProcessor, contextManager, subtasks, apiLoop] as const
}

describe("Task access interfaces", () => {
	it("are checked at compile time by tsc (see the assignments above)", () => {
		expect(typeof assertTaskSatisfiesAccessInterfaces).toBe("function")
	})
})
