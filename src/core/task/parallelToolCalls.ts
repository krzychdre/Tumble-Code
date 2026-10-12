import { type ProviderSettings, isCompactProfile } from "@tumble-code/types"

/**
 * The `parallelToolCalls` value of a request's metadata, read from the task's own
 * profile (the one its API handler was built from). The compact profile asks for one
 * tool call per message (small models lose track of parallel results); every other
 * profile keeps parallel tool calls on, as before. Every handler that sends
 * `parallel_tool_calls` reads it from the metadata, so the task's requests
 * (TaskApiLoop) and its condense requests (TaskContextManager) both resolve it here.
 */
export function resolveParallelToolCalls(taskApiConfiguration: ProviderSettings | undefined): boolean {
	return !isCompactProfile(taskApiConfiguration)
}
