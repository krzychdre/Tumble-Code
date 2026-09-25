import type { ToolName } from "@roo-code/types"

/**
 * Partial-stream state of tool calls, kept on the task that streams them.
 *
 * Every tool is a module singleton shared by all tasks, and parallel subagents
 * stream tool calls at the same time as the foreground task (DEF-C4). A tool
 * must therefore never keep per-call state on itself: it reads and writes the
 * entry of its own name in `task.toolStreamState` through the helpers below,
 * and `BaseTool.resetPartialState(task)` drops that entry.
 *
 * The state is transient: it only lives between the first partial chunk of a
 * tool call and the end of its execute(), and is never persisted.
 */

/** State every tool may keep while one of its calls streams in. */
interface CommonToolStreamState {
	/**
	 * The path seen in the previous partial chunk, used by
	 * `BaseTool.hasPathStabilized()` to skip paths that partial-json truncated.
	 */
	lastSeenPartialPath?: string
}

/** Extra state of the tools that need more than the common fields. */
interface ToolSpecificStreamState {
	write_to_file: {
		/** The last path validated during partial streaming, to avoid re-validating every chunk. */
		lastValidatedPartialPath?: string
		/** The access result for `lastValidatedPartialPath`. */
		lastPartialAccessAllowed?: boolean
	}
	edit_file: {
		/**
		 * The path of the streaming row handlePartial() showed, so execute() can
		 * finalize that row when it fails early.
		 */
		partialToolAskRelPath?: string
	}
}

/** The stream state of one tool: the common fields plus its own, if any. */
export type ToolStreamState<TName extends ToolName = ToolName> = CommonToolStreamState &
	(TName extends keyof ToolSpecificStreamState ? ToolSpecificStreamState[TName] : Record<never, never>)

/** The type of `task.toolStreamState`: one optional entry per tool name. */
export type TaskToolStreamState = { [TName in ToolName]?: ToolStreamState<TName> }

/** The only part of a task these helpers touch (tests pass plain objects). */
interface ToolStreamStateOwner {
	toolStreamState?: TaskToolStreamState
}

/** The stream state of `toolName` on `task`, created empty on first use. */
export function getToolStreamState<TName extends ToolName>(
	task: ToolStreamStateOwner,
	toolName: TName,
): ToolStreamState<TName> {
	const byTool = (task.toolStreamState ??= {}) as Partial<Record<TName, ToolStreamState<TName>>>
	const existing = byTool[toolName]
	if (existing) {
		return existing
	}
	const created = {} as ToolStreamState<TName>
	byTool[toolName] = created
	return created
}

/** Forget the stream state of `toolName` on `task`; other tools' entries stay. */
export function clearToolStreamState(task: ToolStreamStateOwner, toolName: ToolName): void {
	if (task.toolStreamState) {
		delete task.toolStreamState[toolName]
	}
}
