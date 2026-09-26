/**
 * Windows-absolute-path detection and link-text normalization for the
 * openFile messages the webview sends to the extension.
 *
 * The webview cannot use Node's path.isAbsolute here (and on POSIX it would
 * answer false for Windows paths anyway), so these are pure string checks.
 */

// Drive path ("C:/" or "C:\") or UNC ("\\server\share").
// Exactly one ASCII letter before the colon, so "CD:/x" or "README.md:6" (a
// file-with-line link) do not match.
const WINDOWS_ABSOLUTE_PATH_REGEX = /^(?:[a-zA-Z]:[\\/]|\\\\)/

/**
 * Best-effort percent-decoding of a link destination. Markdown parsers
 * percent-encode backslashes ("C:\Users" arrives as "C:%5CUsers"), so paths
 * must be decoded before they are classified or sent to the extension. A
 * string that is not valid percent-encoding (e.g. "50%/of/x") is returned as-is.
 */
export function decodeFilePath(p: string): string {
	try {
		return decodeURIComponent(p)
	} catch {
		return p
	}
}

/**
 * True for Windows absolute paths: drive paths in both slash styles
 * ("C:/Users/a.ts", "C:\Users\a.ts") and UNC paths ("\\server\share\a.ts").
 * Percent-encoded input ("C:%5CUsers%5Ca.ts") is decoded first, so it is safe
 * to call with raw markdown link destinations.
 */
export function isWindowsAbsolutePath(p: string): boolean {
	return WINDOWS_ABSOLUTE_PATH_REGEX.test(decodeFilePath(p))
}

/**
 * Normalizes a path into the text of an "openFile" message:
 * - POSIX absolute, Windows drive and UNC paths pass through untouched, so the
 *   extension's path.isAbsolute/Uri.file see the real path (prefixing them
 *   with "./" made the handler resolve them against the workspace cwd).
 * - Bare relative paths get the "./" prefix, which tells the extension to
 *   resolve them against cwd/home.
 *
 * The input must already be decoded (see decodeFilePath); producers passing
 * real file paths do not need to decode.
 */
export function toOpenFileLinkText(path: string): string {
	if (isWindowsAbsolutePath(path) || path.startsWith("/") || path.startsWith("./")) {
		return path
	}

	return "./" + path
}
