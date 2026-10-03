// Compile-time contract between Task and the narrow access interfaces its
// helper modules (TaskMessageLog, TaskApiLoop, ...) are built with.
//
// Task passes `this` to each helper. Before CORE-R5 every call site used
// `this as unknown as XAccess`, a double cast that silenced real mismatches
// (for example a field that was private on Task but required by the
// interface). The assignments below are checked by `tsc --noEmit` in src
// (tsconfig includes every .ts file), so a Task that stops satisfying one of
// the interfaces fails the type check instead of drifting silently.

import type { Task } from "../Task"
import type { TaskApiLoopAccess } from "../TaskApiLoop"
import type { ApiRequestBuilderAccess } from "../ApiRequestBuilder"
import { AssistantMessageAssemblerAccess } from "../AssistantMessageAssembler"
import { RetryHandlerAccess } from "../RetryHandler"
import { StreamToolCallHandlerAccess } from "../StreamToolCallHandler"
import type { TaskAskSayAccess } from "../TaskAskSay"
import type { TaskContextManagerAccess } from "../TaskContextManager"
import type { TaskResumptionAccess } from "../TaskResumption"
import type { TaskMessageLogAccess } from "../TaskMessageLog"
import type { TaskLifecycleAccess } from "../TaskLifecycle"
import type { TaskStreamProcessorAccess } from "../TaskStreamProcessor"
import type { TaskSubtasksAccess } from "../TaskSubtasks"
import type { TaskTokenTrackingAccess } from "../TaskTokenTracking"
import type * as AccessGroups from "../access-groups"

// Never called: the body exists only so tsc checks each assignment.
function assertTaskSatisfiesAccessInterfaces(task: Task) {
	const lifecycle: TaskLifecycleAccess = task
	const tokenTracking: TaskTokenTrackingAccess = task
	const history: TaskMessageLogAccess = task
	const askSay: TaskAskSayAccess = task
	const streamProcessor: TaskStreamProcessorAccess = task
	const contextManager: TaskContextManagerAccess = task
	const subtasks: TaskSubtasksAccess = task
	const apiLoop: TaskApiLoopAccess = task
	const apiRequestBuilder: ApiRequestBuilderAccess = task
	const retryHandler: RetryHandlerAccess = task
	const resumption: TaskResumptionAccess = task
	const assembler: AssistantMessageAssemblerAccess = task
	const streamToolCallHandler: StreamToolCallHandlerAccess = task
	return [
		lifecycle,
		tokenTracking,
		history,
		askSay,
		streamProcessor,
		contextManager,
		subtasks,
		apiLoop,
		apiRequestBuilder,
		retryHandler,
		resumption,
		assembler,
		streamToolCallHandler,
	] as const
}

// R3-8: the shared member groups every per-module Access interface extends.
// Task must satisfy each group directly too - these assignments are what
// tsc-checks when a group's member set changes.
function assertTaskSatisfiesAccessGroups(task: Task) {
	const taskId: AccessGroups.TaskIdAccess = task
	const providerRef: AccessGroups.TaskProviderRefAccess = task
	const abortFlag: AccessGroups.TaskAbortFlagAccess = task
	const apiHandler: AccessGroups.TaskApiHandlerAccess = task
	const apiConfiguration: AccessGroups.TaskApiConfigurationAccess = task
	const apiConversationHistory: AccessGroups.TaskApiConversationHistoryAccess = task
	const clineMessages: AccessGroups.TaskClineMessagesAccess = task
	const cloudSyncTimestamps: AccessGroups.TaskCloudSyncTimestampsAccess = task
	const backgroundFlag: AccessGroups.TaskBackgroundFlagAccess = task
	const workingDirectory: AccessGroups.TaskWorkingDirectoryAccess = task
	return [
		taskId,
		providerRef,
		abortFlag,
		apiHandler,
		apiConfiguration,
		apiConversationHistory,
		clineMessages,
		cloudSyncTimestamps,
		backgroundFlag,
		workingDirectory,
	] as const
}

describe("Task access interfaces", () => {
	it("are checked at compile time by tsc (see the assignments above)", () => {
		expect(typeof assertTaskSatisfiesAccessInterfaces).toBe("function")
	})

	it("satisfy the shared member groups they extend (see assertTaskSatisfiesAccessGroups)", () => {
		expect(typeof assertTaskSatisfiesAccessGroups).toBe("function")
	})
})
