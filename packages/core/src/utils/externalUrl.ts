/** The schemes a link from the chat may open: web pages and mail. */
const OPENABLE_SCHEMES = new Set(["http:", "https:", "mailto:"])

/**
 * Whether `url` may be handed to the system's opener (`vscode.env.openExternal`,
 * `open`, `xdg-open`, `start`).
 *
 * The URL can come from the model (a fetched page's address on a chat card)
 * or the webview, and the opener runs whatever handles its scheme: a
 * `command:` URI runs a VS Code command, `file:` opens or runs a local file,
 * and other schemes start their registered program. Only an absolute http,
 * https or mailto URL without control characters passes.
 */
export function isOpenableExternalUrl(url: string): boolean {
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f]/.test(url)) {
		return false
	}
	try {
		return OPENABLE_SCHEMES.has(new URL(url).protocol)
	} catch {
		return false
	}
}
