import * as path from "path"

/**
 * Normalize a path for comparison: resolve `.`/`..` segments and duplicate
 * separators, use the platform separator, and drop one trailing separator
 * (a lone separator stays).
 */
function normalizePath(p: string): string {
	let normalized = path.normalize(p)

	if (normalized.length > 1 && (normalized.endsWith("/") || normalized.endsWith("\\"))) {
		normalized = normalized.slice(0, -1)
	}

	return normalized
}

/**
 * Whether two paths name the same location, the way the extension and the CLI
 * match a workspace (task history, the current workspace): after
 * normalization, case-insensitive on Windows only. Two missing paths are
 * equal; one missing path equals nothing.
 */
export function arePathsEqual(path1?: string, path2?: string): boolean {
	if (!path1 && !path2) {
		return true
	}

	if (!path1 || !path2) {
		return false
	}

	const normalized1 = normalizePath(path1)
	const normalized2 = normalizePath(path2)

	if (process.platform === "win32") {
		return normalized1.toLowerCase() === normalized2.toLowerCase()
	}

	return normalized1 === normalized2
}
