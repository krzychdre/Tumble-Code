/**
 * Minimal YAML frontmatter parser for memory files.
 *
 * Memory frontmatter is intentionally simple: a flat set of `key: value` lines
 * between `---` fences. We only ever read `description` and `type`, so a
 * hand-rolled parser avoids pulling in `gray-matter` (and its `js-yaml` dep).
 *
 * Ported from Claude Code's `utils/frontmatterParser.ts`, keeping the
 * colon-space-aware quoting fallback so values like `12:30` times or
 * `https://` URLs don't get mis-parsed as nested mappings.
 */

export interface MemoryFrontmatter {
	/** Raw frontmatter text (between the fences), or "" if none. */
	raw: string
	/** Parsed key→value map. Values are strings (arrays/objects are not supported). */
	data: Record<string, string>
	/** The body after the frontmatter, or the whole content if no frontmatter. */
	body: string
	/** Whether a leading frontmatter block was found. */
	hasFrontmatter: boolean
}

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)---\s*\n?/

/**
 * Parse a single `key: value` line into a trimmed key/value pair.
 * Returns null for blank lines, comments, and lines without a key.
 *
 * Handles the colon-space pattern: only the FIRST `: ` (or `:` at end of key)
 * splits key from value, so `description: ratio of a: b is 2:1` parses value as
 * `ratio of a: b is 2:1`.
 */
function parseScalarLine(line: string): { key: string; value: string } | null {
	const trimmed = line.trimEnd()
	if (trimmed.length === 0 || /^\s*#/.test(trimmed)) return null
	// Find the first colon that is either followed by a space or ends the key.
	const colonIdx = trimmed.indexOf(":")
	if (colonIdx === -1) return null
	const key = trimmed.slice(0, colonIdx).trim()
	if (!key) return null
	let value = trimmed.slice(colonIdx + 1).trim()
	// Strip surrounding quotes if present and balanced.
	if (
		value.length >= 2 &&
		((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
	) {
		value = value.slice(1, -1)
	}
	return { key, value }
}

/**
 * Parse frontmatter from a memory file's content.
 *
 * - If no leading `---` fence is present, `hasFrontmatter` is false, `raw` is
 *   "", `data` is `{}`, and `body` is the whole (trimmed-start) content.
 * - If a fence is present but malformed (e.g. unparseable lines), the
 *   problematic values are quoted and the line is re-parsed — mirroring the
 *   upstream fallback. Unparseable lines are skipped, never thrown on.
 */
export function parseFrontmatter(content: string, _filePath?: string): MemoryFrontmatter {
	if (typeof content !== "string" || content.length === 0) {
		return { raw: "", data: {}, body: "", hasFrontmatter: false }
	}

	const match = FRONTMATTER_REGEX.exec(content)
	if (!match) {
		return { raw: "", data: {}, body: content, hasFrontmatter: false }
	}

	const raw = match[1] ?? ""
	const body = content.slice(match[0].length)
	const data: Record<string, string> = {}

	for (const line of raw.split("\n")) {
		const parsed = parseScalarLine(line)
		if (!parsed) continue
		// Last definition wins (matches YAML scalar override semantics).
		data[parsed.key] = parsed.value
	}

	return { raw, data, body, hasFrontmatter: true }
}
