/**
 * Pure path-based heuristic for identifying plan files.
 *
 * A file is considered a plan file when it ends with `.md` (case-insensitive)
 * AND either:
 *   - any directory segment equals `plans` or `ai_plans` (case-insensitive), or
 *   - the path relative to `cwd` is exactly `plan.md` or `todo.md`
 *     (case-insensitive — only at the workspace root).
 *
 * No `vscode` imports — safe to use from shared/utility code and unit tests.
 */

/**
 * Split a path into segments, normalizing both `/` and `\` separators.
 */
function splitSegments(p: string): string[] {
	return p.split(/[/\\]/).filter((s) => s.length > 0)
}

/**
 * True when `absPath` is a plan file, resolved relative to `cwd` when
 * `cwd` is provided and `absPath` is inside it.
 */
export function isPlanFilePath(absPath: string, cwd: string | undefined): boolean {
	// Compute the path relative to cwd when cwd is given and absPath is inside it;
	// otherwise use absPath's own segments.
	let segments: string[]

	if (cwd) {
		const rel = relativePath(absPath, cwd)
		if (rel !== null) {
			segments = splitSegments(rel)
		} else {
			segments = splitSegments(absPath)
		}
	} else {
		segments = splitSegments(absPath)
	}

	if (segments.length === 0) {
		return false
	}

	const fileName = segments[segments.length - 1]
	if (!fileName.toLowerCase().endsWith(".md")) {
		return false
	}

	// Any directory segment equals `plans` or `ai_plans` (case-insensitive).
	for (let i = 0; i < segments.length - 1; i++) {
		const seg = segments[i].toLowerCase()
		if (seg === "plans" || seg === "ai_plans") {
			return true
		}
	}

	// Exactly `plan.md` or `todo.md` at the cwd root (relative path has 1 segment).
	if (segments.length === 1) {
		const lower = fileName.toLowerCase()
		if (lower === "plan.md" || lower === "todo.md") {
			return true
		}
	}

	return false
}

/**
 * Compute the relative path of `absPath` from `cwd`, or null when `absPath`
 * is not inside `cwd`. Uses simple segment comparison to avoid platform
 * path-dependency issues.
 */
function relativePath(absPath: string, cwd: string): string | null {
	const absSegments = splitSegments(absPath)
	const cwdSegments = splitSegments(cwd)

	// Check that absPath starts with cwd (case-insensitive segment compare).
	if (absSegments.length < cwdSegments.length) {
		return null
	}

	for (let i = 0; i < cwdSegments.length; i++) {
		if (absSegments[i].toLowerCase() !== cwdSegments[i].toLowerCase()) {
			return null
		}
	}

	const relSegments = absSegments.slice(cwdSegments.length)
	return relSegments.join("/")
}
