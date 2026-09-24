import type { ToolName } from "@roo-code/types"

import { Task } from "../task/Task"
import type { ToolUse, HandleError, PushToolResult, AskApproval, NativeToolArgs } from "../../shared/tools"

/**
 * Callbacks passed to tool execution
 */
export interface ToolCallbacks {
	askApproval: AskApproval
	handleError: HandleError
	pushToolResult: PushToolResult
	toolCallId?: string
}

/**
 * Helper type to extract the parameter type for a tool based on its name.
 * If the tool has native args defined in NativeToolArgs, use those; otherwise fall back to any.
 */
type ToolParams<TName extends ToolName> = TName extends keyof NativeToolArgs ? NativeToolArgs[TName] : any

/**
 * Abstract base class for all tools.
 *
 * Tools receive typed arguments from native tool calling via `ToolUse.nativeArgs`.
 *
 * @template TName - The specific tool name, which determines native arg types
 */
export abstract class BaseTool<TName extends ToolName> {
	/**
	 * The tool's name (must match ToolName type)
	 */
	abstract readonly name: TName

	/**
	 * The last path seen during streaming, per task, to detect when the path has stabilized.
	 * Used by hasPathStabilized() to prevent displaying truncated paths from partial-json parsing.
	 *
	 * Keyed by task because every tool is a singleton shared by all tasks, and parallel
	 * subagents stream tool calls at the same time as the foreground task (DEF-C4).
	 * Subclasses with more partial-stream state must key it by task the same way.
	 */
	private lastSeenPartialPathByTask = new WeakMap<Task, string>()

	/**
	 * Execute the tool with typed parameters.
	 *
	 * Receives typed parameters from native tool calling via `ToolUse.nativeArgs`.
	 *
	 * @param params - Typed parameters
	 * @param task - Task instance with state and API access
	 * @param callbacks - Tool execution callbacks (approval, error handling, results)
	 */
	abstract execute(params: ToolParams<TName>, task: Task, callbacks: ToolCallbacks): Promise<void>

	/**
	 * Handle partial (streaming) tool messages.
	 *
	 * Default implementation does nothing. Tools that support streaming
	 * partial messages should override this.
	 *
	 * @param task - Task instance
	 * @param block - Partial ToolUse block
	 */
	async handlePartial(task: Task, block: ToolUse<TName>): Promise<void> {
		// Default: no-op for partial messages
		// Tools can override to show streaming UI updates
	}

	/**
	 * Check if a path parameter has stabilized during streaming.
	 *
	 * During native tool call streaming, the partial-json library may return truncated
	 * string values when chunk boundaries fall mid-value. This method tracks the path
	 * value between consecutive handlePartial() calls and returns true only when the
	 * path has stopped changing (stabilized).
	 *
	 * Usage in handlePartial():
	 * ```typescript
	 * if (!this.hasPathStabilized(task, block.params.path)) {
	 *     return // Path still changing, wait for it to stabilize
	 * }
	 * // Path is stable, proceed with UI updates
	 * ```
	 *
	 * @param task - The task whose stream this chunk belongs to
	 * @param path - The current path value from the partial block
	 * @returns true if path has stabilized (same value seen twice) and is non-empty, false otherwise
	 */
	protected hasPathStabilized(task: Task, path: string | undefined): boolean {
		const lastSeenPartialPath = this.lastSeenPartialPathByTask.get(task)
		const pathHasStabilized = lastSeenPartialPath !== undefined && lastSeenPartialPath === path
		if (path === undefined) {
			this.lastSeenPartialPathByTask.delete(task)
		} else {
			this.lastSeenPartialPathByTask.set(task, path)
		}
		return pathHasStabilized && !!path
	}

	/**
	 * Record a failed tool call: grow the task's consecutive-mistake count, then
	 * record the error for `toolName` (telemetry and the mistake guidance's
	 * example). With `failTurn`, also mark the current turn as failed.
	 *
	 * Replaces the inline `consecutiveMistakeCount++` / `recordToolError(...)` /
	 * `didToolFailInCurrentTurn = true` sequence. `recordToolError` receives the
	 * error argument only when one is given, exactly like the inline calls did.
	 */
	protected recordFailure(
		task: Task,
		toolName: ToolName,
		options: { error?: string; failTurn?: boolean } = {},
	): void {
		task.consecutiveMistakeCount++
		if (options.error === undefined) {
			task.recordToolError(toolName)
		} else {
			task.recordToolError(toolName, options.error)
		}
		if (options.failTurn) {
			task.didToolFailInCurrentTurn = true
		}
	}

	/**
	 * Reset the partial state tracking of one task.
	 *
	 * Should be called at the end of execute() (both success and error paths)
	 * to ensure clean state for the task's next tool invocation. Without a task
	 * it forgets the state of every task (used by tests between cases).
	 */
	resetPartialState(task?: Task): void {
		if (task) {
			this.lastSeenPartialPathByTask.delete(task)
		} else {
			this.lastSeenPartialPathByTask = new WeakMap()
		}
	}

	/**
	 * Main entry point for tool execution.
	 *
	 * Handles the complete flow:
	 * 1. Partial message handling (if partial)
	 * 2. Parameter parsing (nativeArgs only)
	 * 3. Core execution (execute)
	 *
	 * @param task - Task instance
	 * @param block - ToolUse block from assistant message
	 * @param callbacks - Tool execution callbacks
	 */
	async handle(task: Task, block: ToolUse<TName>, callbacks: ToolCallbacks): Promise<void> {
		// Handle partial messages
		if (block.partial) {
			try {
				await this.handlePartial(task, block)
			} catch (error) {
				console.error(`Error in handlePartial:`, error)
				await callbacks.handleError(
					`handling partial ${this.name}`,
					error instanceof Error ? error : new Error(String(error)),
					this.name,
				)
				// TL-4: if handlePartial threw AFTER opening the diff editor
				// (e.g., during update()), the editor stays open with isEditing=true
				// until the next turn's resetStreamingState.  Reset it here so the
				// UI doesn't get stuck.  Guard the reset itself so a failure can't
				// mask the original error already sent to handleError above.
				try {
					await task.diffViewProvider.reset()
				} catch (resetError) {
					console.error(`Error resetting diffViewProvider after partial error:`, resetError)
				}
			}
			return
		}

		// Native-only: obtain typed parameters from `nativeArgs`.
		let params: ToolParams<TName>
		try {
			if (block.nativeArgs !== undefined) {
				// Native: typed args provided by NativeToolCallParser.
				params = block.nativeArgs as ToolParams<TName>
			} else {
				// If legacy/XML markup was provided via params, surface a clear error.
				const paramsText = (() => {
					try {
						return JSON.stringify(block.params ?? {})
					} catch {
						return ""
					}
				})()
				if (paramsText.includes("<") && paramsText.includes(">")) {
					throw new Error(
						"XML tool calls are no longer supported. Use native tool calling (nativeArgs) instead.",
					)
				}
				throw new Error("Tool call is missing native arguments (nativeArgs).")
			}
		} catch (error) {
			console.error(`Error parsing parameters:`, error)
			// Teach, do not just complain: the tool name travels as a separate argument so
			// `formatResponse.toolError` can attach the minimal valid example as a structured
			// field. Embedding it in the message would put it inside a serialized Error and
			// the model would receive it escaped twice.
			const errorMessage = `Failed to parse ${this.name} parameters: ${error instanceof Error ? error.message : String(error)}`
			await callbacks.handleError(`parsing ${this.name} args`, new Error(errorMessage), this.name)
			// Note: handleError already emits a tool_result via formatResponse.toolError in the caller.
			// Do NOT call pushToolResult here to avoid duplicate tool_result payloads.
			return
		}

		// Execute with typed parameters.
		//
		// The catch is a safety net, not the main error path: every tool that has a
		// top-level try/catch already reports its own runtime failures through
		// `handleError`. What is left unprotected is the prefix each tool runs BEFORE
		// opening that try (parameter checks, workspace lookups, the first file read)
		// plus the tools that have no try at all. A throw from there used to escape
		// into nothing: `presentAssistantMessage` is called un-awaited from
		// `TaskStreamProcessor` and `TaskApiLoop`, so the rejection had no owner and the
		// model got no tool_result at all.
		//
		// Routing it through `handleError` gives it the same treatment as any other
		// runtime failure: an error say, a teaching tool_result carrying this tool's
		// minimal valid example, and one increment of the mistake counter.
		//
		// `didToolFailInCurrentTurn` is deliberately NOT set here: `attempt_completion`
		// refuses to run when that flag is set, and flipping it centrally would change
		// control flow, not just error reporting.
		try {
			await this.execute(params, task, callbacks)
		} catch (error) {
			console.error(`Error executing ${this.name}:`, error)
			await callbacks.handleError(
				`executing ${this.name}`,
				error instanceof Error ? error : new Error(String(error)),
				this.name,
			)
		}
	}
}
