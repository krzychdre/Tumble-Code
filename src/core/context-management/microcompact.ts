import { Anthropic } from "@anthropic-ai/sdk"

import { ApiMessage } from "../task-persistence/apiMessages"
import { getEffectiveApiHistory } from "../condense"

/**
 * Tool-result microcompaction.
 *
 * A cheap, deterministic, NO-LLM pre-pass that clears the *content* of OLD tool
 * results (keeping the most recent N at full fidelity) before resorting to the
 * expensive, lossy full summarization (`summarizeConversation`). This is a port
 * of Claude Code's `microcompact` stage, which runs before `autocompact` in its
 * compaction pipeline. Old tool output (file reads, command stdout, search
 * results, ...) is the largest, lowest-signal, fastest-growing portion of a
 * coding conversation, so clearing it reclaims the bulk of the tokens while
 * leaving the entire dialogue — user/assistant turns, decisions, and the
 * `tool_use` requests themselves — completely intact.
 *
 * Because it makes no model call, it cannot fail or hallucinate on a weak local
 * model (GLM/Qwen/Llama); the cleared content is simply replaced with a fixed,
 * human-readable sentinel that tells the model how to recover the data if needed.
 */

/**
 * Placeholder that replaces the content of an old tool result when it is
 * microcompacted. Written to be explicit and actionable so that even weak local
 * models understand the content was intentionally removed and know the recovery
 * action, rather than treating the cleared block as an empty (failed) result.
 */
export const MICROCOMPACT_CLEARED_PLACEHOLDER =
	"[Old tool output cleared to save context. Re-read the file or re-run the command if you need this output again.]"

/**
 * Default number of most-recent compactable tool results to keep at full
 * fidelity. Older results have their content cleared. Keeping several recent
 * results raw preserves the model's immediate working set, which weak models
 * depend on heavily.
 */
export const MICROCOMPACT_KEEP_RECENT = 5

/**
 * Tool names whose results are bulky and cheaply re-derivable (re-read / re-run),
 * making them safe to clear. Mirrors Claude Code's `COMPACTABLE_TOOLS` set.
 *
 * Results from tools NOT in this set (e.g. attempt_completion,
 * ask_followup_question, update_todo_list, switch_mode, new_task, skill,
 * run_slash_command, generate_image, tools_load) are ALWAYS preserved — they
 * carry irreplaceable state or are small enough that clearing them is pointless.
 */
export const COMPACTABLE_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
	"read_file",
	"read_command_output",
	"execute_command",
	"search_files",
	"list_files",
	"codebase_search",
	"use_mcp_tool",
	"access_mcp_resource",
	"write_to_file",
	"apply_diff",
	"apply_patch",
	"edit",
	"edit_file",
	"search_replace",
	"search_and_replace",
])

export interface MicrocompactOptions {
	/** How many of the most-recent compactable tool results to keep raw. */
	keepRecent?: number
}

export interface MicrocompactResult {
	/**
	 * The full message array with old compactable tool-result content cleared.
	 * Returns the SAME reference as the input when nothing was changed, so callers
	 * can cheaply detect a no-op with `result.messages === messages`.
	 */
	messages: ApiMessage[]
	/** Number of tool results whose content was cleared. */
	clearedCount: number
	/** The tool_use_ids whose results were cleared. */
	clearedToolUseIds: string[]
	/**
	 * Concatenation of the original cleared content as plain text. Lets the caller
	 * estimate the freed token count with a single `countTokens` call instead of
	 * recounting the whole (large) history.
	 */
	clearedText: string
}

/**
 * Flattens a tool_result block's content to plain text, for token estimation of
 * what is being removed. Images/other blocks are noted but not measured here
 * (image token cost is handled elsewhere).
 */
function toolResultContentToText(content: Anthropic.Messages.ToolResultBlockParam["content"]): string {
	if (typeof content === "string") {
		return content
	}
	if (Array.isArray(content)) {
		return content
			.map((block) => {
				if (block.type === "text") {
					return block.text
				}
				return ""
			})
			.join("\n")
	}
	return ""
}

/** A tool_result whose content has already been cleared by a prior pass. */
function isAlreadyCleared(block: Anthropic.Messages.ToolResultBlockParam): boolean {
	return block.content === MICROCOMPACT_CLEARED_PLACEHOLDER
}

/**
 * Clears the content of old compactable tool results, keeping the most recent
 * `keepRecent` raw. Pure and idempotent: re-running on already-microcompacted
 * messages is a no-op for the already-cleared blocks.
 *
 * @param messages The full API conversation history (including tagged messages).
 * @param options.keepRecent How many recent compactable results to keep raw.
 * @returns The (possibly new) message array plus what was cleared.
 */
export function microcompactToolResults(messages: ApiMessage[], options: MicrocompactOptions = {}): MicrocompactResult {
	const noop: MicrocompactResult = { messages, clearedCount: 0, clearedToolUseIds: [], clearedText: "" }

	const keepRecent = Math.max(1, options.keepRecent ?? MICROCOMPACT_KEEP_RECENT)

	// Only consider the effective (non-condensed, non-truncated) history. Hidden
	// messages are filtered out before the API anyway, so clearing them is moot,
	// and selecting "recent" within them would be wrong.
	const effective = getEffectiveApiHistory(messages)

	// Map tool_use_id -> tool name from assistant tool_use blocks so we can tell
	// which results came from compactable (bulky, re-derivable) tools.
	const toolNameById = new Map<string, string>()
	for (const msg of effective) {
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "tool_use") {
					toolNameById.set(block.id, block.name)
				}
			}
		}
	}

	// Collect compactable tool_use_ids in encounter order (by tool_result), so
	// "keep the last N" tracks the most recent tool interactions.
	const compactableIds: string[] = []
	for (const msg of effective) {
		if (msg.role === "user" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "tool_result") {
					const name = toolNameById.get(block.tool_use_id)
					if (name && COMPACTABLE_TOOL_NAMES.has(name)) {
						compactableIds.push(block.tool_use_id)
					}
				}
			}
		}
	}

	// Nothing to gain if we have at most `keepRecent` compactable results.
	if (compactableIds.length <= keepRecent) {
		return noop
	}

	const keepSet = new Set(compactableIds.slice(-keepRecent))
	const clearSet = new Set(compactableIds.filter((id) => !keepSet.has(id)))

	const clearedToolUseIds: string[] = []
	let clearedText = ""

	const newMessages = messages.map((msg) => {
		if (msg.role !== "user" || !Array.isArray(msg.content)) {
			return msg
		}
		let touched = false
		const newContent = msg.content.map((block) => {
			if (block.type === "tool_result") {
				const tr = block as Anthropic.Messages.ToolResultBlockParam
				if (clearSet.has(tr.tool_use_id) && !isAlreadyCleared(tr)) {
					const text = toolResultContentToText(tr.content)
					if (text) {
						clearedText += text + "\n"
					}
					clearedToolUseIds.push(tr.tool_use_id)
					touched = true
					return { ...tr, content: MICROCOMPACT_CLEARED_PLACEHOLDER }
				}
			}
			return block
		})
		if (!touched) {
			return msg
		}
		return { ...msg, content: newContent }
	})

	if (clearedToolUseIds.length === 0) {
		return noop
	}

	return {
		messages: newMessages,
		clearedCount: clearedToolUseIds.length,
		clearedToolUseIds,
		clearedText,
	}
}
