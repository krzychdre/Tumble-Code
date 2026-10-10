// Context-management rules of the compact profile (small local models, see
// ai_plans/2026-10-10_19-36_compact-small-model-profile.md). Kept out of index.ts so the
// specs that stub the whole context-management module do not have to stub these too.

/**
 * Condense threshold under the compact profile (percent of the context window), used when the
 * profile has no valid threshold of its own.
 *
 * Worked for the target, a 40,960-token window with the compact output reservation of 4,096
 * (`getCompactOutputReservation`): the hard limit (`allowedTokens`, 90 percent minus the
 * reservation) sits at 32,768 tokens, 80 percent. The condense request runs on the same model
 * and window. It drops the regular system prompt and tool array (about 2.5k tokens) and adds the
 * summary system prompt, the condense instructions and the compact tool array (about 3k), so it
 * is roughly the size of the context it condenses, plus the 4,096 reserved for the summary. Started
 * at 70 percent (28,672 tokens), it needs about 33k of the 40,960: some 8k tokens of headroom for
 * the turn that crossed the threshold and for the gap between token estimates and the server's
 * tokenizer. It still fits for a context up to about 36k (88 percent), so even the 80 percent hard
 * limit condenses safely. Lower would condense more often, and every condense of a full window
 * costs minutes of prompt processing on a small local GPU (about 130 tokens per second).
 */
export const COMPACT_CONDENSE_THRESHOLD_PERCENT = 70

/**
 * The global condense percent a request uses. Under the compact profile it is capped at
 * COMPACT_CONDENSE_THRESHOLD_PERCENT: the stored global setting cannot be told apart from its
 * default (100, "never by percentage"), so a lower global value still wins and a valid per-profile
 * threshold still overrides both (resolveCondenseThreshold). Off the compact profile it is the
 * global percent unchanged.
 */
export function resolveGlobalCondensePercent(globalPercent: number, compact: boolean): number {
	return compact ? Math.min(globalPercent, COMPACT_CONDENSE_THRESHOLD_PERCENT) : globalPercent
}
