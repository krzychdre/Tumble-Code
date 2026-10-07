import type { ModelInfo, ProviderSettings } from "@tumble-code/types"

import { ApiMessage } from "../task-persistence/apiMessages"
import { getEffectiveApiHistory } from "../condense"

/**
 * Old-reasoning trimming ("Shorten old reasoning when the context fills up",
 * `openAiTrimOldReasoning`).
 *
 * With "Return reasoning to the model" (`openAiPreserveReasoning`) every assistant turn goes
 * back to the model with its full plain-text reasoning block. Measured on 14 CLI tasks
 * (GLM-5.3 and Flash, 2026-10-07) that is 20-38% of the history in thinking-heavy tasks
 * (one task: ~110k of ~312k tokens). This module shortens the reasoning of OLD turns in the
 * outgoing copy only; the stored history stays complete.
 *
 * Why only under context pressure: the server hits the prefix cache for 94-98% of input
 * tokens, so old reasoning costs almost no compute. Rewriting old messages on every request
 * would move the first changed byte back and cost more than it saves. The pass therefore runs
 * inside the microcompact pre-pass of `manageContext` (only when the context is over the
 * condense threshold or the allowed tokens), and every decision is carried over to later
 * requests so the trimmed prefix stays identical from then on.
 *
 * Why deterministic trimming instead of a model summary: no extra model call, nothing that can
 * fail or hallucinate on a weak local model, and the same input text always gives the same
 * output text, which is what keeps the prompt cache hitting after the first trim.
 *
 * The rule, measured on the same tasks: blocks over ~500 tokens are a third of all blocks but
 * 78% of the reasoning, so shorter blocks are never touched. A long block keeps its head
 * (~100 tokens), its last paragraph and every paragraph that states a finding; each run of
 * dropped paragraphs becomes one marker. That saves ~50% of the reasoning and keeps every
 * finding paragraph (example from a task: 2695 -> 921 tokens).
 *
 * Wiring: there is no separate state. A trimmed block is recorded as `reasoningTrimKey(ts)`
 * in the SAME id set that holds the tool_use_ids of microcompacted tool results
 * (`Task.microcompactedIds`), selected by `selectReasoningTrims` in `manageContext` and
 * applied at send time by `applyReasoningTrims` in `ApiRequestBuilder`.
 */

/**
 * Blocks shorter than this (~500 tokens at ~4 chars per token) are never trimmed.
 *
 * Blocks over ~500 tokens are 33% of the blocks but 78% of the reasoning, so the floor gives
 * up little reclaim while sparing the many short blocks that would only lose a sentence or two.
 */
export const REASONING_TRIM_MIN_CHARS = 2_000

/**
 * Head kept from every trimmed block (~100 tokens), in whole paragraphs. Findings cluster at
 * the start of a block, and the opening tells the model what that turn was about.
 */
export const REASONING_TRIM_HEAD_CHARS = 400

/**
 * Newest assistant messages whose reasoning is never trimmed, whatever the pressure: the
 * model's immediate line of thought. Same floor as `MICROCOMPACT_MIN_KEEP` for tool results.
 */
export const REASONING_TRIM_KEEP_RECENT = 3

/**
 * A paragraph that states a finding, kept in every trimmed block.
 *
 * Findings, NOT plans. Measured on 151 long GLM reasoning blocks: findings ("found", "root
 * cause", "confirmed") cluster at the start of a block but occur all through it, while plans
 * ("let me", "next") grow towards the end. The plans of an old turn are already executed and
 * visible as that turn's tool call, so dropping them loses nothing the model cannot see.
 *
 * Word-start anchored and case-insensitive. The list is deliberately broad ("works" also
 * matches "workspace"): a false positive only keeps a paragraph, which is the safe direction.
 * The Polish stems cover "wniosek"/"wnioskuje" and "przyczyna"/"przyczyny".
 */
export const REASONING_FINDING_PATTERN =
	/\b(?:found|root cause|the (?:issue|problem|bug|error) is|confirmed|smoking gun|revelation|turns out|so the|works|fails|failed|broken|fixed|wnios|przyczyn)/i

/**
 * The paragraph that replaces one run of `count` dropped paragraphs. ASCII only and worded
 * so even a weak model reads it as a deliberate omission, not as a broken message.
 */
export const REASONING_TRIM_MARKER = (count: number): string =>
	`[... ${count} paragraph(s) of earlier reasoning omitted to save context ...]`

/** Paragraph separator: a blank line (possibly holding whitespace). */
const PARAGRAPH_SPLIT = /\n\s*\n/

/** Prefix of every reasoning key; it cannot collide with a tool_use_id ("call_...", "toolu_..."). */
const REASONING_KEY_PREFIX = "reasoning:"

/**
 * Key of one assistant message's reasoning block in the shared microcompact id set.
 */
export function reasoningTrimKey(ts: number): string {
	return `${REASONING_KEY_PREFIX}${ts}`
}

/**
 * A paragraph this module wrote. Always kept, so trimming already-trimmed text is a no-op
 * instead of folding the old marker into a new one.
 */
function isTrimMarker(paragraph: string): boolean {
	const count = /^\[\.\.\. (\d+) /.exec(paragraph)?.[1]
	return count !== undefined && paragraph === REASONING_TRIM_MARKER(Number(count))
}

/**
 * Shortens one reasoning text: keeps the head paragraphs up to `REASONING_TRIM_HEAD_CHARS`,
 * the last paragraph and every paragraph matching `REASONING_FINDING_PATTERN`, and replaces
 * each run of dropped paragraphs with one `REASONING_TRIM_MARKER`.
 *
 * Pure and deterministic: the same text always gives the same result (prompt-cache stability).
 * A block without blank lines is one paragraph and is never trimmed.
 *
 * @returns The shortened text, or `undefined` when the text is under `REASONING_TRIM_MIN_CHARS`,
 *   nothing would be dropped, or the result would not be shorter.
 */
export function trimReasoningText(text: string): string | undefined {
	if (text.length < REASONING_TRIM_MIN_CHARS) {
		return undefined
	}

	const paragraphs = text.split(PARAGRAPH_SPLIT).filter((paragraph) => paragraph.trim() !== "")
	const lastIndex = paragraphs.length - 1

	const kept: string[] = []
	let headChars = 0
	let droppedRun = 0
	let droppedAny = false

	paragraphs.forEach((paragraph, index) => {
		// Whole paragraphs: one that starts inside the head budget is kept entire.
		const inHead = headChars < REASONING_TRIM_HEAD_CHARS
		headChars += paragraph.length
		if (inHead || index === lastIndex || REASONING_FINDING_PATTERN.test(paragraph) || isTrimMarker(paragraph)) {
			if (droppedRun > 0) {
				kept.push(REASONING_TRIM_MARKER(droppedRun))
				droppedRun = 0
			}
			kept.push(paragraph)
			return
		}
		droppedRun++
		droppedAny = true
	})

	if (!droppedAny) {
		return undefined
	}
	const trimmed = kept.join("\n\n")
	return trimmed.length < text.length ? trimmed : undefined
}

/**
 * The plain-text reasoning of an assistant message: its FIRST content block when that block is
 * `{ type: "reasoning", text: string }` (the shape `ApiRequestBuilder` sends back with
 * "Return reasoning to the model"). Encrypted reasoning (`encrypted_content`) is opaque to us
 * and must reach the provider byte for byte, so it never qualifies.
 */
function plainReasoningText(message: ApiMessage): string | undefined {
	if (message.role !== "assistant" || !Array.isArray(message.content)) {
		return undefined
	}
	// Reasoning blocks are not part of the Anthropic content-block union, hence the widening.
	const first = message.content[0] as { type?: unknown; text?: unknown; encrypted_content?: unknown } | undefined
	if (first?.type !== "reasoning" || typeof first.text !== "string" || first.encrypted_content !== undefined) {
		return undefined
	}
	return first.text
}

export interface ReasoningTrimSelectionOptions {
	/**
	 * Characters the caller must reclaim. Selection stops as soon as this is met. Omit to trim
	 * everything eligible; 0 keeps only the carried-over decisions.
	 */
	targetChars?: number
	/**
	 * Keys selected on a PREVIOUS request (the shared microcompact id set; tool_use_ids in it are
	 * ignored). Always taken again, so the trimmed prefix only grows and the cache keeps hitting.
	 */
	alreadyTrimmed?: ReadonlySet<string>
}

export interface ReasoningTrimSelection {
	/** `reasoningTrimKey`s of the blocks to trim, carried-over ones first. */
	keys: string[]
	/** Sum over the selected blocks of (original length - trimmed length). */
	reclaimedChars: number
}

/**
 * Chooses which old reasoning blocks to trim.
 *
 * Works on the effective history (what is actually sent), like `microcompactToolResults`.
 * Candidates are assistant messages with a numeric `ts` and a trimmable plain-text reasoning
 * block, outside the newest `REASONING_TRIM_KEEP_RECENT` assistant messages. Every carried-over
 * candidate is taken first, then the oldest remaining ones until `targetChars` is met: oldest
 * first keeps the first changed byte as late in the conversation as possible.
 */
export function selectReasoningTrims(
	messages: ApiMessage[],
	options: ReasoningTrimSelectionOptions = {},
): ReasoningTrimSelection {
	const targetChars = options.targetChars ?? Number.POSITIVE_INFINITY
	const assistants = getEffectiveApiHistory(messages).filter((message) => message.role === "assistant")
	const older = assistants.slice(0, Math.max(0, assistants.length - REASONING_TRIM_KEEP_RECENT))

	const candidates: { key: string; reclaim: number }[] = []
	for (const message of older) {
		const text = plainReasoningText(message)
		if (typeof message.ts !== "number" || text === undefined) {
			continue
		}
		const trimmed = trimReasoningText(text)
		if (trimmed !== undefined) {
			candidates.push({ key: reasoningTrimKey(message.ts), reclaim: text.length - trimmed.length })
		}
	}

	const keys: string[] = []
	const taken = new Set<string>()
	let reclaimedChars = 0
	const take = (candidate: { key: string; reclaim: number }) => {
		keys.push(candidate.key)
		taken.add(candidate.key)
		reclaimedChars += candidate.reclaim
	}

	const alreadyTrimmed = options.alreadyTrimmed
	if (alreadyTrimmed?.size) {
		candidates.filter((candidate) => alreadyTrimmed.has(candidate.key)).forEach(take)
	}
	for (const candidate of candidates) {
		if (reclaimedChars >= targetChars) {
			break
		}
		if (!taken.has(candidate.key)) {
			take(candidate)
		}
	}

	return { keys, reclaimedChars }
}

/**
 * Send-time, NON-DESTRUCTIVE application of the trim decision, the reasoning twin of
 * `applyMicrocompactCleared`: returns a copy of `messages` in which the reasoning block of
 * every assistant message whose `reasoningTrimKey(ts)` is in `ids` carries
 * `trimReasoningText(text)`. Keys that are not reasoning keys (tool_use_ids) are ignored.
 *
 * Never mutates the input; returns the SAME reference when nothing applies.
 */
export function applyReasoningTrims(messages: ApiMessage[], ids: ReadonlySet<string>): ApiMessage[] {
	if (ids.size === 0) {
		return messages
	}

	let anyTouched = false
	const result = messages.map((message) => {
		if (typeof message.ts !== "number" || !ids.has(reasoningTrimKey(message.ts))) {
			return message
		}
		const text = plainReasoningText(message)
		const trimmed = text === undefined ? undefined : trimReasoningText(text)
		if (trimmed === undefined || !Array.isArray(message.content)) {
			return message
		}
		const [first, ...rest] = message.content
		anyTouched = true
		return { ...message, content: [{ ...first, text: trimmed } as typeof first, ...rest] }
	})

	return anyTouched ? result : messages
}

/**
 * The one gate: trim only when the user enabled it AND reasoning is sent back at all. Without
 * "Return reasoning to the model" there is nothing to trim.
 *
 * Why the provider is checked: the setting belongs to the OpenAI Compatible profile only, but
 * provider settings are one flat object, so a value set there outlives a switch to another
 * provider (the profile dropdown only changes `apiProvider`; the CLI merges its startup
 * settings key by key into the persisted state). Z.ai, DeepSeek, Moonshot, MiniMax and some
 * Bedrock models declare `preserveReasoning` themselves, so without this check a stale `true`
 * would trim their reasoning although no checkbox for it is shown there.
 */
export function shouldTrimOldReasoning(
	settings: Pick<ProviderSettings, "apiProvider" | "openAiTrimOldReasoning">,
	modelInfo: Pick<ModelInfo, "preserveReasoning">,
): boolean {
	return (
		settings.apiProvider === "openai" &&
		settings.openAiTrimOldReasoning === true &&
		modelInfo.preserveReasoning === true
	)
}
