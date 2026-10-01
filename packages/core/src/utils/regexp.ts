/**
 * Escape every regular-expression metacharacter so the string matches itself
 * literally inside a `RegExp`.
 */
export function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
