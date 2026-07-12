import stripBom from "strip-bom"

/**
 * Repeatedly strips BOM characters from the input until no more are found.
 * Some edge-case files can contain nested BOMs (e.g. after concatenation or
 * encoding mishaps), so a single `strip-bom` pass is not enough.
 */
export function stripAllBOMs(input: string): string {
	let result = input
	let previous

	do {
		previous = result
		result = stripBom(result)
	} while (result !== previous)

	return result
}
