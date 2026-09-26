/**
 * Background memory extraction.
 *
 * Runs once at task completion (main agent only) to save memories the main
 * agent didn't get around to writing. It is ONE small completion, not an
 * agent: the model sees a short instruction, the list of existing memories
 * (file name + one-line description) and the user-prose signal of the
 * conversation (see transcript.ts), and answers `NONE` or up to
 * {@link MAX_DRAFTS_PER_RUN} memories in a plain `## <type>: <name>` block
 * format. The code writes the files (memoryFiles.ts). A typical run costs
 * 2-4k input tokens, so it works on small local models too; the earlier
 * design spawned a full "code"-mode sub-Task that paid the whole agent
 * system prompt on every one of up to five turns (40-50k tokens each).
 *
 * Design notes:
 * - **Mutual exclusion**: if the main agent already wrote to a memory path
 *   this turn, extraction is skipped (the save criteria overlap; no need to
 *   re-extract). Detected via `hasMemoryWritesSince`.
 * - **Cursor**: each run only considers messages since the previous
 *   extraction. The cursor advances only on success.
 * - **No signal, no call**: an empty transcript (no user prose) skips the
 *   model call entirely.
 * - **Fire-and-forget**: the lifecycle hook calls `executeExtractMemories`
 *   with `void` — it never blocks the main response.
 * - **Drain**: on shutdown, `drainPendingExtraction()` awaits in-flight
 *   extractions with a 60s soft timeout (`.unref()`'d so it never blocks exit).
 *
 * The completion is injected as a {@link SideQuery} (the same contract the
 * recall ranker uses) so this module stays decoupled from the API layer.
 */

import { resolve } from "path"

import type { ClineMessage } from "@roo-code/types"

import { logger } from "../../utils/logging"
import { isAutoMemPath, getAutoMemPath, isAutoMemoryEnabled } from "./paths"
import { type MemoryHeader, scanMemoryFiles } from "./memoryScan"
import { MEMORY_TYPES, parseMemoryType } from "./memoryTypes"
import { type MemoryDraft, saveMemoryDraft } from "./memoryFiles"
import { type SideQuery } from "./relevance"

/**
 * The slice of a `ClineMessage` the extractor inspects: file writes show up
 * as tool-approval asks (`type: "ask"`, `ask: "tool"`) whose JSON `text`
 * names the tool and the file.
 */
export type ExtractionMessageView = Pick<ClineMessage, "type" | "ask" | "text" | "partial" | "isAnswered">

/** The `ClineSayTool.tool` values the file-writing tools ask with. */
const FILE_WRITE_ASK_TOOLS = new Set(["newFileCreated", "editedExistingFile", "appliedDiff"])

export interface ExtractionContext {
	cwd: string
	/** Whether this is the main agent (sub-agents are excluded). */
	isMainAgent: boolean
	/** The conversation messages to inspect (for mutual-exclusion detection). */
	messages: ReadonlyArray<ExtractionMessageView>
	/**
	 * The bounded user-prose signal of the conversation, built by the caller
	 * (TaskLifecycle) via `renderTranscript(apiConversationHistory)`. Empty or
	 * undefined means there is nothing to extract: no model call is made.
	 */
	transcript?: string
	/** The one-shot completion the extraction asks. */
	query: SideQuery
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

/** @internal — test only: the current cursor-map key insertion order (LRU tail = most recent). */
export function _cursorKeys(): string[] {
	return [...lastMemoryMessageCursors.keys()]
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
 *
 * A write counts when its tool-approval ask was answered with an approval
 * (`isAnswered`, set by auto-approval and by the user's Save click; a
 * rejected ask keeps it unset) and is no longer a streaming partial. The ask
 * stores `getReadablePath(cwd, relPath)`: relative to `cwd` inside the
 * workspace, absolute (POSIX separators) outside it, so resolve against `cwd`.
 */
export function hasMemoryWritesSince(
	messages: ReadonlyArray<ExtractionMessageView>,
	cwd: string,
	sinceCursor: number,
): boolean {
	for (let i = sinceCursor; i < messages.length; i++) {
		const m = messages[i]
		if (m?.type !== "ask" || m.ask !== "tool" || m.partial || m.isAnswered !== true || !m.text) continue
		let tool: unknown
		try {
			tool = JSON.parse(m.text)
		} catch {
			continue
		}
		if (!tool || typeof tool !== "object") continue
		const { tool: name, path: filePath } = tool as { tool?: unknown; path?: unknown }
		if (typeof name !== "string" || !FILE_WRITE_ASK_TOOLS.has(name)) continue
		if (typeof filePath !== "string" || filePath.length === 0) continue
		if (isAutoMemPath(resolve(cwd, filePath), cwd)) return true
	}
	return false
}

/** Cap on memories written per extraction; a chat rarely holds more than one. */
export const MAX_DRAFTS_PER_RUN = 3
/** Manifest lines shown to the model (most recently modified first). */
const MAX_MANIFEST_ENTRIES = 50
const MAX_MANIFEST_DESCRIPTION_CHARS = 80
const MAX_DRAFT_BODY_CHARS = 1500

/**
 * The extraction instruction. Kept short and literal for small models: one
 * decision (NONE or blocks), one output shape, one example.
 */
export const EXTRACTION_SYSTEM_PROMPT = [
	"You pick facts worth remembering from a chat between a user and a coding assistant.",
	"Save ONLY what helps in future chats and cannot be found by reading the code:",
	"- user: who the user is, their role and preferences",
	'- feedback: a correction or a confirmed approach from the user ("do not X", "always Y"), with the reason',
	"- project: goals, deadlines, decisions, who owns what; write dates as YYYY-MM-DD",
	"- reference: where information lives in external systems (URLs, trackers, dashboards)",
	"Do NOT save code details, file paths, git history, fix recipes, or progress of the current task.",
	"",
	"Most chats hold nothing worth saving. Then answer exactly: NONE",
	"",
	`Otherwise write each memory (at most ${MAX_DRAFTS_PER_RUN}) as:`,
	"## <type>: <short_name>",
	"<one-line summary>",
	"<details, 1 to 5 lines>",
	"",
	"To add to an existing memory, use its file name as <short_name>.",
	"Write nothing else.",
	"",
	"Example answer:",
	"## feedback: real_db_in_tests",
	"Integration tests must use a real database, not mocks.",
	"Why: mocked tests passed while a broken migration shipped.",
].join("\n")

function formatManifest(existing: ReadonlyArray<MemoryHeader>): string {
	return existing
		.slice(0, MAX_MANIFEST_ENTRIES)
		.map((m) => {
			const description = (m.description ?? "").replace(/\s+/g, " ").trim()
			const short =
				description.length > MAX_MANIFEST_DESCRIPTION_CHARS
					? description.slice(0, MAX_MANIFEST_DESCRIPTION_CHARS).trimEnd() + "..."
					: description
			return short ? `- ${m.filename}: ${short}` : `- ${m.filename}`
		})
		.join("\n")
}

export function buildExtractionUserPrompt(existing: ReadonlyArray<MemoryHeader>, transcript: string): string {
	return ["Existing memories:", formatManifest(existing) || "(none)", "", "Chat:", transcript.trim()].join("\n")
}

const DRAFT_HEADER_RE = new RegExp(
	`^\\s*(?:#{1,4}\\s*|\\*\\*)\\s*(${MEMORY_TYPES.join("|")})\\s*[:\\-]\\s*(.+?)\\s*(?:\\*\\*)?\\s*$`,
	"i",
)

/**
 * Parse the model's answer into drafts. Tolerant of what small models add:
 * a `<think>` block, code fences, bold instead of a heading, a
 * `description:` label. Anything that is not a well-formed block is ignored,
 * so prose or `NONE` yields no drafts.
 */
export function parseMemoryDrafts(answer: string): MemoryDraft[] {
	if (typeof answer !== "string") return []
	const text = answer.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```[a-z]*\n?/gi, "")
	const drafts: MemoryDraft[] = []
	let current: { type: MemoryDraft["type"]; name: string; lines: string[] } | undefined
	const flush = () => {
		if (!current) return
		const lines = current.lines.map((l) => l.trim()).filter(Boolean)
		const description = (lines[0] ?? "").replace(/^(?:summary|description)\s*:\s*/i, "")
		const body = lines.slice(1).join("\n") || description
		if (description) {
			drafts.push({
				type: current.type,
				name: current.name,
				description,
				body: body.slice(0, MAX_DRAFT_BODY_CHARS),
			})
		}
		current = undefined
	}
	for (const line of text.split("\n")) {
		const header = DRAFT_HEADER_RE.exec(line)
		const type = header ? parseMemoryType(header[1].toLowerCase()) : undefined
		if (header && type) {
			flush()
			current = { type, name: header[2].replace(/[`*]/g, "").trim(), lines: [] }
		} else if (current) {
			current.lines.push(line)
		}
	}
	flush()
	return drafts.slice(0, MAX_DRAFTS_PER_RUN)
}

/**
 * Get the per-task cursor, refreshing recency (LRU: delete + re-insert at tail
 * so the entry is the least-likely to be evicted).
 */
function getCursor(taskId: string): number | undefined {
	const value = lastMemoryMessageCursors.get(taskId)
	if (value === undefined) return undefined
	lastMemoryMessageCursors.delete(taskId)
	lastMemoryMessageCursors.set(taskId, value)
	return value
}

/**
 * Set the per-task cursor, refreshing recency (LRU: delete + re-insert at tail)
 * and bounding the map size by evicting the least-recently-USED entry.
 */
function setCursor(taskId: string, value: number): void {
	lastMemoryMessageCursors.delete(taskId)
	lastMemoryMessageCursors.set(taskId, value)
	if (lastMemoryMessageCursors.size > MAX_CURSOR_ENTRIES) {
		const lru = lastMemoryMessageCursors.keys().next().value
		if (lru !== undefined) lastMemoryMessageCursors.delete(lru)
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
	const cursor = getCursor(context.taskId) ?? 0
	const lengthAtStart = context.messages.length
	const newMessageCount = lengthAtStart - cursor
	if (newMessageCount <= 0) return

	// Mutual exclusion: main agent already wrote a memory → skip + advance cursor.
	if (hasMemoryWritesSince(context.messages, context.cwd, cursor)) {
		setCursor(context.taskId, lengthAtStart)
		return
	}

	const transcript = context.transcript?.trim() ?? ""
	if (!transcript) {
		// No user prose since the task started: nothing a memory could hold.
		setCursor(context.taskId, lengthAtStart)
		return
	}

	const memoryDir = getAutoMemPath(context.cwd)
	const controller = new AbortController()
	const existing = await scanMemoryFiles(memoryDir, controller.signal)

	// Declare the promise holder first so the `finally` can deregister itself
	// without a use-before-assignment error.
	const run: Promise<void> | undefined = (async () => {
		try {
			const answer = await context.query(
				EXTRACTION_SYSTEM_PROMPT,
				buildExtractionUserPrompt(existing, transcript),
				controller.signal,
			)
			const today = new Date().toISOString().slice(0, 10)
			const written: string[] = []
			for (const draft of parseMemoryDrafts(answer)) {
				const filePath = await saveMemoryDraft(memoryDir, draft, existing, today)
				if (filePath && !written.includes(filePath)) written.push(filePath)
			}
			// Advance cursor only on success, using the T0 snapshot so messages
			// appended mid-run are reconsidered next time.
			setCursor(context.taskId, lengthAtStart)
			if (written.length > 0 && context.onSaved) {
				context.onSaved(written.length, written)
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
