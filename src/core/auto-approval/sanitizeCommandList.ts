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

/**
 * The allowed commands a fresh install (or a reset state) starts with: the
 * user's own setting, else the setting's default. Never a workspace or folder
 * value: the first repository opened after install must not be able to seed
 * global state with commands it wants auto-approved.
 */
export function initialAllowedCommands(
	scopes: { globalValue?: unknown; defaultValue?: unknown } | undefined,
): string[] {
	return sanitizeCommandList(scopes?.globalValue ?? scopes?.defaultValue)
}
