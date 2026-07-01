/**
 * Relevant-memory ranking — the recall "side query".
 *
 * Ported from Claude Code's `memdir/findRelevantMemories.ts`. The LLM call is
 * injected as a {@link SideQuery} function so this module stays decoupled from
 * the API layer and unit-testable with a stub. The caller (prefetch) wires it
 * to the task's `ApiHandler` via a `completePrompt`-style adapter.
 *
 * The selector prompt asks the model to return up to 5 memory filenames that
 * will *clearly* be useful for the query. The JSON-schema-constrained output
 * (`{ "selected_memories": string[] }`) is the load-bearing contract — it
 * guarantees parseable results. We parse defensively and filter to known
 * filenames so a hallucinated name can't surface a non-existent file.
 */

import { type MemoryHeader, scanMemoryFiles, formatMemoryManifest } from "./memoryScan"
import { type RelevantMemory, readMemoriesForSurfacing } from "./surfacing"

export { type MemoryHeader } from "./memoryScan"

const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories that will be useful to the agent as it processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a JSON object with a "selected_memories" array of filenames for the memories that will clearly be useful as the agent processes the user's query (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful in processing the user's query, then do not include it in your list. Be selective and discerning.
- If there are no memories in the list that would clearly be useful, return an empty array.
- If a list of recently-used tools is provided, do not select memories that are usage reference or API documentation for those tools (the agent is already exercising them). DO still select memories containing warnings, gotchas, or known issues about those tools — active use is exactly when those matter.

Respond with ONLY a JSON object of the form: {"selected_memories": ["file1.md", "file2.md"]}`

/**
 * A lightweight one-shot LLM completion. Implementations:
 * - In production: wired to the task's `ApiHandler` (a fast/cheap model).
 * - In tests: a stub returning a fixed JSON string.
 *
 * Must throw on abort so the caller can detect cancellation.
 */
export type SideQuery = (system: string, user: string, signal: AbortSignal) => Promise<string>

/** Shared selector prompt for unit tests / reuse. */
export const SELECTOR_SYSTEM_PROMPT = SELECT_MEMORIES_SYSTEM_PROMPT

/**
 * Ask the side-query model which memory filenames are relevant to `query`.
 *
 * Returns the intersection of the model's selection and the valid filenames —
 * a hallucinated name is silently dropped. On any error (except abort), returns
 * `[]` so a flaky ranker never breaks the main task.
 */
export async function selectRelevantMemories(
	query: string,
	memories: MemoryHeader[],
	signal: AbortSignal,
	recentTools: readonly string[],
	sideQuery: SideQuery,
): Promise<string[]> {
	const validFilenames = new Set(memories.map((m) => m.filename))
	const manifest = formatMemoryManifest(memories)
	const toolsSection = recentTools.length > 0 ? `\n\nRecently used tools: ${recentTools.join(", ")}` : ""

	let text: string
	try {
		text = await sideQuery(
			SELECT_MEMORIES_SYSTEM_PROMPT,
			`Query: ${query}\n\nAvailable memories:\n${manifest}${toolsSection}`,
			signal,
		)
	} catch (e) {
		if (signal.aborted) return []
		return []
	}

	const parsed = parseSelectedMemories(text)
	if (!parsed) return []
	return parsed.filter((f) => validFilenames.has(f))
}

/**
 * Parse the side-query output into a filename list.
 *
 * The model is prompted to return strict JSON, but we defend against prose
 * wrappers (```json fences, leading text) by extracting the first {...} block.
 */
export function parseSelectedMemories(text: string): string[] | null {
	if (typeof text !== "string" || text.length === 0) return null
	let candidate = text.trim()
	// Strip a markdown code fence if present.
	const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
	if (fenceMatch) candidate = fenceMatch[1].trim()
	// Extract the first balanced {...} block if there's surrounding prose.
	const start = candidate.indexOf("{")
	const end = candidate.lastIndexOf("}")
	if (start !== -1 && end !== -1 && end > start) {
		candidate = candidate.slice(start, end + 1)
	}
	try {
		const obj = JSON.parse(candidate) as { selected_memories?: unknown }
		const arr = obj.selected_memories
		if (!Array.isArray(arr)) return null
		return arr.filter((x): x is string => typeof x === "string")
	} catch {
		return null
	}
}

/**
 * The full recall ranker: scan → rank → resolve to surfaced memories.
 *
 * Already-surfaced paths (from earlier turns this session) are excluded before
 * ranking so the model spends its 5-slot budget on fresh candidates.
 */
export async function findRelevantMemories(
	query: string,
	memoryDir: string,
	signal: AbortSignal,
	recentTools: readonly string[],
	alreadySurfaced: ReadonlySet<string>,
	sideQuery: SideQuery,
): Promise<RelevantMemory[]> {
	const memories = (await scanMemoryFiles(memoryDir, signal)).filter((m) => !alreadySurfaced.has(m.filePath))
	if (memories.length === 0) return []

	const selectedFilenames = await selectRelevantMemories(query, memories, signal, recentTools, sideQuery)
	const byFilename = new Map(memories.map((m) => [m.filename, m]))
	const selected = selectedFilenames.map((f) => byFilename.get(f)).filter((m): m is MemoryHeader => m !== undefined)

	const toRead = selected.map((m) => ({ path: m.filePath, mtimeMs: m.mtimeMs }))
	return readMemoriesForSurfacing(toRead, signal)
}

/**
 * Collect the names of tools that succeeded since the last user turn.
 *
 * Scans backward from `lastUserMessageIndex`; a tool is "succeeded" only if it
 * has a non-error result AND never errored in the window. The two rules worth
 * porting verbatim:
 * - "any error → excluded": a tool that errored even once is NOT suppressed
 *   (the model may be struggling, so docs stay available).
 * - "no result yet → excluded": outcome unknown, so don't suppress.
 *
 * @param messages The conversation messages (assistant `tool_use` + user
 *   `tool_result` blocks). The structural shape mirrors Claude Code's; callers
 *   adapt Roo's `ClineMessage` format into this minimal view.
 */
export interface RecentToolMessageView {
	type: "assistant" | "user"
	/** Assistant content blocks (only `tool_use` matters here). */
	toolUses?: Array<{ id: string; name: string }>
	/** User tool-result blocks. */
	toolResults?: Array<{ tool_use_id: string; is_error?: boolean }>
}

export function collectRecentSuccessfulTools(
	messages: ReadonlyArray<RecentToolMessageView>,
	lastUserMessageIndex: number,
): readonly string[] {
	const useIdToName = new Map<string, string>()
	const resultByUseId = new Map<string, boolean>()
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]
		if (!m) continue
		if (m.type === "assistant") {
			for (const block of m.toolUses ?? []) {
				useIdToName.set(block.id, block.name)
			}
		} else if (m.type === "user") {
			// A user message carries tool_results if it's part of the current
			// tool round-trip (the model emitted tool_use, the harness replied
			// with tool_result). A "real" human turn has NO tool_results.
			const hasToolResults = (m.toolResults?.length ?? 0) > 0
			if (!hasToolResults && i !== lastUserMessageIndex) {
				// Previous human turn — stop scanning. Anything before it is a
				// prior turn's tool round-trip, out of scope for "recent".
				break
			}
			for (const block of m.toolResults ?? []) {
				// is_error === true → errored; absent/false → succeeded.
				resultByUseId.set(block.tool_use_id, block.is_error === true)
			}
		}
	}
	const failed = new Set<string>()
	const succeeded = new Set<string>()
	for (const [id, name] of useIdToName) {
		const errored = resultByUseId.get(id)
		if (errored === undefined) continue // no result yet → outcome unknown → exclude
		if (errored) failed.add(name)
		else succeeded.add(name)
	}
	return [...succeeded].filter((t) => !failed.has(t)) // any error → excluded
}
