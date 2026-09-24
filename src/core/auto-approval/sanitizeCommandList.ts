/**
 * Normalises an allowed/denied command list coming from settings, global
 * state or the webview: anything that is not an array becomes `[]`, and
 * only non-blank string entries are kept. Entries are not trimmed and
 * duplicates are kept; callers that merge lists dedupe themselves.
 */
export function sanitizeCommandList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return []
	}
	return value.filter((cmd): cmd is string => typeof cmd === "string" && cmd.trim().length > 0)
}
