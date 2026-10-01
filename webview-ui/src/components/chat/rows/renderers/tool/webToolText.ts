// Text helpers for the web_search and web_fetch rows.

/** One piece of a search query: plain words, an operator, or a quoted phrase. */
export interface QueryPart {
	kind: "text" | "operator" | "quote"
	text: string
}

// Operators the row tints: `site:`-style prefixes, the boolean words, and
// quoted phrases. Anything else stays plain text.
const QUERY_TOKEN =
	/("[^"]*")|\b((?:site|filetype|ext|intitle|allintitle|inurl|allinurl|intext|allintext|related|before|after):)|\b(OR|AND)\b/g

/** Splits a query into the parts the row styles differently. */
export function splitSearchQuery(query: string): QueryPart[] {
	const parts: QueryPart[] = []
	let last = 0
	for (const match of query.matchAll(QUERY_TOKEN)) {
		const index = match.index ?? 0
		if (index > last) parts.push({ kind: "text", text: query.slice(last, index) })
		parts.push({ kind: match[1] ? "quote" : "operator", text: match[0] })
		last = index + match[0].length
	}
	if (last < query.length) parts.push({ kind: "text", text: query.slice(last) })
	return parts
}

/**
 * An http(s) URL as its host (without `www.`) and the rest (path, query and
 * hash). Undefined for anything that is not an http(s) URL, so the row shows
 * the raw text and offers no link.
 */
export function splitWebUrl(url: string): { host: string; rest: string } | undefined {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return undefined
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined
	const rest = parsed.pathname + parsed.search + parsed.hash
	return { host: parsed.host.replace(/^www\./, ""), rest: rest === "/" ? "" : rest }
}
