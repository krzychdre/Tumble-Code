import * as path from "path"

// Mirrors normalizePath/arePathsEqual in the extension's src/utils/path.ts, so
// the CLI and the extension agree on which task history belongs to a
// workspace. Keep the two in step until they move to a shared package.

/**
 * Normalize a path: resolve `.`/`..` segments and duplicate separators, use
 * the platform separator, and drop trailing separators (a root stays a root).
 */
export function normalizePath(p: string): string {
	let normalized = path.normalize(p)
	while (normalized.length > 1 && /[/\\]$/.test(normalized) && normalized !== path.parse(normalized).root) {
		normalized = normalized.slice(0, -1)
	}
	return normalized
}

/**
 * Compare two paths for equality, handling:
 * - Trailing slashes
 * - Path separator differences
 * - Case sensitivity (case-insensitive on Windows only, like the extension)
 *
 * Two missing paths are equal; one missing path equals nothing.
 */
export function arePathsEqual(path1?: string, path2?: string): boolean {
	if (!path1 && !path2) {
		return true
	}
	if (!path1 || !path2) {
		return false
	}

	const normalizedPath1 = normalizePath(path1)
	const normalizedPath2 = normalizePath(path2)

	if (process.platform === "win32") {
		return normalizedPath1.toLowerCase() === normalizedPath2.toLowerCase()
	}

	return normalizedPath1 === normalizedPath2
}
