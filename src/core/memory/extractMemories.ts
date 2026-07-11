/**
 * Background memory extraction.
 *
 * Ported from Claude Code's `services/extractMemories/extractMemories.ts`.
 * Runs once at task completion (main agent only) to save memories the main
 * agent didn't get around to writing. It runs as a sandboxed sub-Task:
 * - read_file / search_files / list_files unrestricted;
 * - execute_command read-only;
 * - write_to_file / edit_file only inside `isAutoMemPath`.
 *
 * Design notes:
 * - **Mutual exclusion**: if the main agent already wrote to a memory path
 *   this turn, extraction is skipped (the save criteria overlap; no need to
 *   re-extract). Detected via `hasMemoryWritesSince`.
 * - **Cursor**: each run only considers messages since the previous
 *   extraction. The cursor advances only on success.
 * - **`maxTurns: 5`**: expects read-all (turn 1) → write-all (turn 2).
 * - **Fire-and-forget**: the lifecycle hook calls `executeExtractMemories`
 *   with `void` — it never blocks the main response.
 * - **Drain**: on shutdown, `drainPendingExtraction()` awaits in-flight
 *   extractions with a 60s soft timeout (`.unref()`'d so it never blocks exit).
 *
 * The sub-Task spawn is injected via {@link SubTaskRunner} so this module
 * stays decoupled from the `Task` class and unit-testable with a stub.
 */

import { basename } from "path"

import { logger } from "../../utils/logging"
import { isAutoMemPath, getAutoMemPath, isAutoMemoryEnabled } from "./paths"
import { ENTRYPOINT_NAME } from "./memoryPrompt"
import { formatMemoryManifest, scanMemoryFiles } from "./memoryScan"

/** A view of the conversation messages the extractor inspects. */
export interface ExtractionMessageView {
	/** Assistant tool-use blocks written by the model. */
	toolUses?: Array<{ name: string; input?: Record<string, unknown> }>
}

/** The result of a sub-Task run: the file paths the agent wrote/edited. */
export interface SubTaskResult {
	/** Absolute paths the sub-agent wrote or edited. */
	writtenPaths: string[]
}

/**
 * Spawn a sandboxed sub-Task with the given system prompt + user prompt and
 * return the file paths it wrote. The implementation (in the lifecycle hook)
 * wires the sandbox to Roo's tool-approval path and `maxTurns: 5`.
 */
export type SubTaskRunner = (params: {
	cwd: string
	systemPrompt: string
	userPrompt: string
	maxTurns: number
	signal: AbortSignal
}) => Promise<SubTaskResult>

export interface ExtractionContext {
	cwd: string
	/** Whether this is the main agent (sub-agents are excluded). */
	isMainAgent: boolean
	/** The conversation messages to inspect (for mutual-exclusion detection). */
	messages: ReadonlyArray<ExtractionMessageView>
	/**
	 * A bounded, pre-rendered transcript of the recent conversation, embedded in
	 * the extraction prompt so the *fresh* sub-agent has content to analyze. Built
	 * by the caller (TaskLifecycle) via `renderTranscript(apiConversationHistory)`.
	 * Empty/undefined → the prompt omits the transcript section.
	 */
	transcript?: string
	/** The sandboxed sub-Task spawner. */
	subTaskRunner: SubTaskRunner
	/** Called with a "Saved N memories" notice on success (may be a no-op). */
	onSaved?: (count: number, paths: string[]) => void
	/** The task this extraction belongs to; the extraction cursor is tracked per task. */
	taskId: string
}

// Module-scoped state. Extraction cursors are per-task: each value is an index
// into that task's own messages array.
let inFlightExtractions = new Set<Promise<void>>()
const lastMemoryMessageCursors = new Map<string, number>()
// AbortControllers for in-flight extractions, so drain can cancel live sub-tasks
// on shutdown timeout instead of orphaning them.
const inFlightControllers = new Set<AbortController>()

// The cursor only matters for the completion→abort double-fire window of a
// single task; 64 entries is far more than any realistic concurrent task count.
const MAX_CURSOR_ENTRIES = 64

/** Reset module state — for tests only. */
export function resetExtractionState(): void {
	inFlightExtractions = new Set<Promise<void>>()
	lastMemoryMessageCursors.clear()
	inFlightControllers.clear()
}

/** @internal — test only */
export function _inFlightExtractionsCount(): number {
	return inFlightExtractions.size
}

/**
 * Shared drain algorithm: await in-flight promises with a soft timeout, abort
 * remaining controllers on timeout, then await a bounded grace period so
 * aborted work can settle and deregister before the drain returns.
 *
 * Used by both {@link drainPendingExtraction} and `drainPendingDreams` — the
 * registries stay separate, only the drain ALGORITHM is shared.
 *
 * The drain never hangs forever: if the grace period expires with promises
 * still unsettled (a truly stuck task), it returns anyway.
 */
export async function drainInFlight(
	promises: Set<Promise<void>>,
	controllers: Set<AbortController>,
	timeoutMs: number,
	graceMs: number = 5_000,
): Promise<void> {
	if (promises.size === 0) return
	const inflight = [...promises]
	let timer: NodeJS.Timeout | undefined
	const timeout = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, timeoutMs)
		timer.unref?.()
	})
	await Promise.race([Promise.allSettled(inflight), timeout])
	if (timer) clearTimeout(timer)
	// If anything is still in flight after the timeout, abort their controllers
	// and give them a bounded grace period to settle + deregister.
	if (promises.size > 0) {
		for (const c of controllers) c.abort()
		const stillInFlight = [...promises]
		let graceTimer: NodeJS.Timeout | undefined
		const grace = new Promise<void>((resolve) => {
			graceTimer = setTimeout(resolve, graceMs)
			graceTimer.unref?.()
		})
		await Promise.race([Promise.allSettled(stillInFlight), grace])
		if (graceTimer) clearTimeout(graceTimer)
	}
}

/**
 * Did the main agent already write to a memory path in the message range since
 * the cursor? If so, skip extraction (mutual exclusion) and advance the cursor.
 */
export function hasMemoryWritesSince(
	messages: ReadonlyArray<ExtractionMessageView>,
	cwd: string,
	sinceCursor: number,
): boolean {
	for (let i = sinceCursor; i < messages.length; i++) {
		const m = messages[i]
		if (!m?.toolUses) continue
		for (const use of m.toolUses) {
			const input = use.input ?? {}
			const filePath = (input.path as string) || (input.file_path as string)
			if (typeof filePath === "string" && isAutoMemPath(filePath, cwd)) {
				return true
			}
		}
	}
	return false
}

function buildExtractionPrompt(newMessageCount: number, existingManifest: string, transcript?: string): string {
	const lines = [
		"You are now acting as the memory extraction subagent. Analyze the recent conversation below (the ~" +
			newMessageCount +
			" most recent messages) and save any durable memories the main agent should have saved but didn't.",
		"",
		"Available tools: read_file, search_files, list_files (unrestricted), execute_command (read-only only — ls/find/cat/stat/wc/head/tail), and write_to_file / edit_file for paths inside the memory directory only. All other tools will be denied.",
		"",
		"You have a limited turn budget. edit_file requires a prior read_file of the same file, so the efficient strategy is: turn 1 — issue all read_file calls in parallel for every file you might update; turn 2 — issue all write_to_file / edit_file calls in parallel. Do not interleave reads and writes across multiple turns.",
		"",
		"You MUST only use content from the recent conversation below to update your persistent memories. Do not waste any turns attempting to investigate or verify that content further — no grepping source files, no reading code to confirm a pattern exists, no git commands.",
		"",
		"If the user explicitly asks you to remember something, save it immediately.",
		"",
		"Existing memories — check this list before writing; update an existing file rather than creating a duplicate:",
		existingManifest || "(none yet)",
	]

	if (transcript && transcript.trim()) {
		lines.push("", "## Recent conversation", "", transcript.trim())
	}

	return lines.join("\n")
}

/** Set the per-task cursor, bounding the map size. */
function setCursor(taskId: string, value: number): void {
	lastMemoryMessageCursors.set(taskId, value)
	if (lastMemoryMessageCursors.size > MAX_CURSOR_ENTRIES) {
		const oldest = lastMemoryMessageCursors.keys().next().value
		if (oldest !== undefined) lastMemoryMessageCursors.delete(oldest)
	}
}

/**
 * Run a single extraction. Gated on: memory enabled, main agent, no direct
 * writes this turn. Fire-and-forget by the caller; tracked in
 * `inFlightExtractions` for {@link drainPendingExtraction}.
 */
export async function executeExtractMemories(context: ExtractionContext): Promise<void> {
	if (!isAutoMemoryEnabled() || !context.isMainAgent) return

	// Snapshot the message length at T0, before the multi-second extraction
	// sub-task runs. Messages appended during the sub-task (T0→T1) must NOT be
	// skipped — they'll be picked up by the next extraction.
	const cursor = lastMemoryMessageCursors.get(context.taskId) ?? 0
	const lengthAtStart = context.messages.length
	const newMessageCount = lengthAtStart - cursor
	if (newMessageCount <= 0) return

	// Mutual exclusion: main agent already wrote a memory → skip + advance cursor.
	if (hasMemoryWritesSince(context.messages, context.cwd, cursor)) {
		setCursor(context.taskId, lengthAtStart)
		return
	}

	const memoryDir = getAutoMemPath(context.cwd)
	const controller = new AbortController()
	const existing = await scanMemoryFiles(memoryDir, controller.signal)
	const manifest = formatMemoryManifest(existing)
	const prompt = buildExtractionPrompt(newMessageCount, manifest, context.transcript)

	// Declare the promise holder first so the `finally` can deregister itself
	// without a use-before-assignment error.
	let run: Promise<void> | undefined
	run = (async () => {
		try {
			const result = await context.subTaskRunner({
				cwd: context.cwd,
				systemPrompt: buildExtractionSystemPrompt(memoryDir),
				userPrompt: prompt,
				maxTurns: 5,
				signal: controller.signal,
			})
			// Advance cursor only on success, using the T0 snapshot so messages
			// appended mid-run are reconsidered next time.
			setCursor(context.taskId, lengthAtStart)
			// Index touches aren't "memories" — filter MEMORY.md out of the count.
			const memoryPaths = result.writtenPaths.filter((p) => basename(p) !== ENTRYPOINT_NAME)
			if (memoryPaths.length > 0 && context.onSaved) {
				context.onSaved(memoryPaths.length, memoryPaths)
			}
		} catch (e) {
			// Cursor stays put on error so those messages are reconsidered next time.
			logger.error(`[memory] extractMemories failed: ${e instanceof Error ? e.message : String(e)}`)
		} finally {
			if (run) inFlightExtractions.delete(run)
			inFlightControllers.delete(controller)
		}
	})()
	// Registered together so the `finally` above always deregisters both.
	inFlightControllers.add(controller)
	inFlightExtractions.add(run)
}

function buildExtractionSystemPrompt(memoryDir: string): string {
	return [
		"You are the memory extraction subagent. You save durable memories about the user, their feedback, the project, and external references to the memory directory.",
		"",
		`Memory directory: ${memoryDir}`,
		"You may only write to files inside this directory. You may read anywhere and run read-only shell commands.",
		"",
		"Save only what is durable and non-obvious: user role/preferences, explicit feedback/corrections, non-derivable project context, and external-system pointers.",
		"Do NOT save code patterns, architecture, file paths, git history, debugging recipes, or ephemeral task state.",
	].join("\n")
}

/**
 * Await in-flight extractions with a 60s soft timeout. Called on shutdown.
 * The timeout is `.unref()`'d so it never blocks process exit. When the timeout
 * fires with extractions still pending, abort their controllers so live sub-tasks
 * are cancelled instead of orphaned. After aborting, a bounded grace period
 * (5s) is awaited so aborted work can settle and deregister before the drain
 * returns — callers treat the drain's return as "background writers are done".
 */
export async function drainPendingExtraction(timeoutMs: number = 60_000, graceMs: number = 5_000): Promise<void> {
	await drainInFlight(inFlightExtractions, inFlightControllers, timeoutMs, graceMs)
}
