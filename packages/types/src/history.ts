import { z } from "zod"

/**
 * HistoryItem
 */

export const historyItemSchema = z.object({
	id: z.string(),
	rootTaskId: z.string().optional(),
	parentTaskId: z.string().optional(),
	number: z.number(),
	ts: z.number(),
	task: z.string(),
	tokensIn: z.number(),
	tokensOut: z.number(),
	cacheWrites: z.number().optional(),
	cacheReads: z.number().optional(),
	totalCost: z.number(),
	size: z.number().optional(),
	workspace: z.string().optional(),
	mode: z.string().optional(),
	apiConfigName: z.string().optional(), // Provider profile name for sticky profile feature
	status: z.enum(["active", "completed", "delegated"]).optional(),
	// Whether the task's last step is its completion result, read from its
	// messages on every save. `status` cannot tell: only a subtask that hands
	// its result back to its parent ever becomes "completed".
	outcome: z.enum(["completed", "unfinished"]).optional(),
	delegatedToId: z.string().optional(), // Last child this parent delegated to
	childIds: z.array(z.string()).optional(), // All children spawned by this task (new_task foreground delegation)
	// Headless background children spawned by `run_parallel_tasks`. Kept
	// separate from `childIds` (which implies sequential foreground delegation
	// and drives the delegated/awaitingChildId state machine) so the two
	// flows do not collide. Persisted going forward; pre-fix history items
	// simply lack the field and rehydration falls back to an empty panel.
	parallelChildIds: z.array(z.string()).optional(),
	// Set on the history item of a `run_parallel_tasks` child. Its
	// `parentTaskId` names the task that fanned out (for nesting and the
	// subtree cost), but it is not a `new_task` child: it never hands a
	// result back through delegation, opens read-only, and its `workspace` is
	// the parent's workspace (it ran in a git worktree that may be gone).
	isSubagent: z.boolean().optional(),
	awaitingChildId: z.string().optional(), // Child currently awaited (set when delegated)
	completedByChildId: z.string().optional(), // Child that completed and resumed this parent
	completionResultSummary: z.string().optional(), // Summary from completed child
})

export type HistoryItem = z.infer<typeof historyItemSchema>
