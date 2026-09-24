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
