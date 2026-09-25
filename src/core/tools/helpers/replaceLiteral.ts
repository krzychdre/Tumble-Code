/**
 * Replace a literal string, with the replacement kept literal too.
 *
 * `String.prototype.replace` and `replaceAll` expand `$&`, `$1`, `$$`,
 * `` $` ``, `$'` and `$<name>` in a string replacement; a replacer function
 * is never expanded. Every edit tool uses this one helper so model-written
 * code such as `"$1"` or `` `${x}` `` reaches the file unchanged.
 *
 * An empty `search` never matches (the content is returned as is).
 */
export function replaceLiteral(
	content: string,
	search: string,
	replacement: string,
	options: { all: boolean },
): string {
	if (search === "") {
		return content
	}
	return options.all ? content.replaceAll(search, () => replacement) : content.replace(search, () => replacement)
}
