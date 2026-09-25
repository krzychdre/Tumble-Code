import { z } from "zod"

/**
 * Interface for follow-up data structure used in follow-up questions
 * This represents the data structure for follow-up questions that the LLM can ask
 * to gather more information needed to complete a task.
 */
export interface FollowUpData {
	/** The question being asked by the LLM */
	question?: string
	/** Array of suggested answers that the user can select */
	suggest?: Array<SuggestionItem>
}

/**
 * Interface for a suggestion item with optional mode switching
 */
export interface SuggestionItem {
	/**
	 * The text of the suggestion.
	 *
	 * Optional because models (especially weak ones) can emit malformed follow-up
	 * suggestions with a missing, blank or non-string answer, and the transport does
	 * not validate `FollowUpData`. Guard with `hasUsableAnswer()` before using it.
	 */
	answer?: string
	/** Optional mode to switch to when selecting this suggestion */
	mode?: string
}

/**
 * Whether a follow-up suggestion carries a usable answer: a string that is not blank.
 * Accepts `unknown` input because the data comes from unvalidated model output.
 */
export const hasUsableAnswer = (suggestion: unknown): suggestion is SuggestionItem & { answer: string } =>
	typeof suggestion === "object" &&
	suggestion !== null &&
	typeof (suggestion as { answer?: unknown }).answer === "string" &&
	(suggestion as { answer: string }).answer.trim().length > 0

/**
 * The first suggestion with a usable answer, if any. Used by follow-up auto-approval so
 * a blank or missing answer is never sent back to the model as the user's reply.
 */
export const firstUsableSuggestion = (suggestions: unknown): (SuggestionItem & { answer: string }) | undefined =>
	Array.isArray(suggestions) ? suggestions.find(hasUsableAnswer) : undefined

/** A suggestion that can be offered: a usable answer and, when valid, a mode slug. */
export type UsableSuggestion = { answer: string; mode?: string }

/**
 * The question and the offerable suggestions of a follow-up ask's text, read
 * the same way everywhere. The text is unvalidated model output: anything but
 * a JSON object yields no question and no suggestions, a question that is not
 * a string is dropped, suggestions without a usable answer are dropped, and a
 * mode that is not a non-empty string is dropped.
 */
export function parseFollowUpData(text: string | undefined): { question?: string; suggestions: UsableSuggestion[] } {
	let data: unknown

	try {
		data = JSON.parse(text ?? "")
	} catch {
		return { suggestions: [] }
	}

	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return { suggestions: [] }
	}

	const { question, suggest } = data as { question?: unknown; suggest?: unknown }
	const suggestions = (Array.isArray(suggest) ? suggest.filter(hasUsableAnswer) : []).map(({ answer, mode }) =>
		typeof mode === "string" && mode.length > 0 ? { answer, mode } : { answer },
	)

	return typeof question === "string" ? { question, suggestions } : { suggestions }
}

/**
 * The mode to switch to when a suggestion is chosen, if any. A manual choice
 * always switches to the suggestion's mode; an automatic one (a countdown or a
 * timeout default) only when mode switches are auto-approved.
 */
export function suggestionModeToSwitch(
	suggestion: { mode?: unknown },
	choice: { manual: boolean; alwaysAllowModeSwitch?: boolean },
): string | undefined {
	const { mode } = suggestion

	if (typeof mode !== "string" || mode.length === 0) {
		return undefined
	}

	return choice.manual || choice.alwaysAllowModeSwitch ? mode : undefined
}

/**
 * Zod schema for SuggestionItem
 */
export const suggestionItemSchema = z.object({
	answer: z.string().optional(),
	mode: z.string().optional(),
})

/**
 * Zod schema for FollowUpData
 */
export const followUpDataSchema = z.object({
	question: z.string().optional(),
	suggest: z.array(suggestionItemSchema).optional(),
})

export type FollowUpDataType = z.infer<typeof followUpDataSchema>
