import { z } from "zod"

/**
 * Subagent (parallel background subtask) status, as shown in the webview
 * subagents panel.
 *
 * - "queued": registered at fan-out time, waiting for a concurrency slot.
 * - "running": the child is streaming/working.
 * - "awaiting_input": the child asked a question and is blocked on the user
 *   (interactive followup; a fallback timer keeps unattended runs bounded).
 * - "completed" / "failed" / "cancelled": terminal, kept visible with the
 *   rest of the task's subagents.
 */
export const subagentStatuses = ["queued", "running", "awaiting_input", "completed", "failed", "cancelled"] as const

export const subagentStatusSchema = z.enum(subagentStatuses)

export type SubagentStatus = z.infer<typeof subagentStatusSchema>

/**
 * Lightweight, serializable summary of one parallel subagent, streamed to the
 * webview so the user can observe headless children without them ever joining
 * the foreground task stack.
 */
export const subagentSummarySchema = z.object({
	taskId: z.string(),
	/** Task that fanned out (`run_parallel_tasks` caller). */
	parentTaskId: z.string(),
	/**
	 * The `run_parallel_tasks` call (fan-out) that started it: the call's start
	 * time in base 36, so ids sort in start order. A task that fanned out
	 * several times keeps the rows of every run. Missing on rows saved before
	 * runs were told apart, when the run cannot be worked out.
	 */
	runId: z.string().optional(),
	/** 0-based position within the fan-out, stable for display ordering. */
	index: z.number(),
	mode: z.string(),
	/** First line(s) of the subtask message, truncated for display. */
	description: z.string(),
	status: subagentStatusSchema,
	/** Name of the API profile the child runs on (when known). */
	apiConfigName: z.string().optional(),
	tokensIn: z.number(),
	tokensOut: z.number(),
	totalCost: z.number(),
	startedAt: z.number(),
	lastActivityAt: z.number(),
	/**
	 * Terminal-state payload: the child's attempt_completion text (completed)
	 * or failure reason (failed), truncated for transport. Lets the panel show
	 * outcomes after the child task instance has been disposed.
	 */
	finalMessage: z.string().optional(),
})

export type SubagentSummary = z.infer<typeof subagentSummarySchema>
