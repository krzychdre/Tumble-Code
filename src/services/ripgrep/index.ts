import * as path from "path"

import * as vscode from "vscode"

import { readCliRuntimeEnv } from "@roo-code/types"

import { RooIgnoreController } from "../../core/ignore/RooIgnoreController"
import { fileExistsAtPath } from "../../utils/fs"

import { runRipgrep, RipgrepError, RunRipgrepResult } from "./runner"
/*
This file provides functionality to perform regex searches on files using ripgrep.
Inspired by: https://github.com/DiscreteTom/vscode-ripgrep-utils

Key components:
1. getBinPath: Locates the ripgrep binary inside the VS Code installation.
2. runRipgrep (./runner): Spawns ripgrep with the shared limit, timeout and error rules.
3. regexSearchFiles: The main function that performs regex searches on files.
   - Parameters:
     * cwd: The current working directory (for relative path calculation)
     * directoryPath: The directory to search in
     * regex: The regular expression to search for (Rust regex syntax)
     * filePattern: Optional glob pattern to filter files (default: '*')
   - Returns: A formatted string containing search results with context

The search results include:
- Relative file paths
- 2 lines of context before and after each match
- Matches formatted with pipe characters for easy reading

Usage example:
const results = await regexSearchFiles('/path/to/cwd', '/path/to/search', 'TODO:', '*.ts');

rel/path/to/app.ts
│----
│function processData(data: any) {
│  // Some processing logic here
│  // TODO: Implement error handling
│  return processedData;
│}
│----

rel/path/to/helper.ts
│----
│  let result = 0;
│  for (let i = 0; i < input; i++) {
│    // TODO: Optimize this function for performance
│    result += Math.pow(i, 2);
│  }
│----
*/

const isWindows = process.platform.startsWith("win")
const binName = isWindows ? "rg.exe" : "rg"

// VS Code's @vscode/ripgrep-universal package (used by recent VS Code builds,
// including the Insiders staged-install layout) nests the binary under
// bin/<platform>-<arch>/ rather than directly in bin/.
const ripgrepUniversalBinDir = `bin/${process.platform}-${process.arch}`

interface SearchFileResult {
	file: string
	searchResults: SearchResult[]
}

interface SearchResult {
	lines: SearchLineResult[]
}

interface SearchLineResult {
	line: number
	text: string
	isMatch: boolean
	column?: number
}
// Constants
const MAX_RESULTS = 300
const MAX_LINE_LENGTH = 500
// ripgrep --json prints begin/match/context/end records; assume at most 5 lines per result.
const MAX_OUTPUT_LINES = MAX_RESULTS * 5
/** A search_files run that takes longer than this returns the matches found so far. */
export const REGEX_SEARCH_TIMEOUT_MS = 30_000

/**
 * Truncates a line if it exceeds the maximum length
 * @param line The line to truncate
 * @param maxLength The maximum allowed length (defaults to MAX_LINE_LENGTH)
 * @returns The truncated line, or the original line if it's shorter than maxLength
 */
export function truncateLine(line: string, maxLength: number = MAX_LINE_LENGTH): string {
	return line.length > maxLength ? line.substring(0, maxLength) + " [truncated...]" : line
}
/**
 * Returns the ordered list of absolute candidate paths where ripgrep may
 * live under the given VS Code appRoot. Used by both getBinPath (first-match
 * resolution) and the diagnostic command (existence report for all paths).
 */
export function ripgrepCandidatePaths(vscodeAppRoot: string): readonly string[] {
	// @vscode/ripgrep >=1.18 (VS Code 1.130+) keeps the binary in a per-platform
	// optional package, e.g. @vscode/ripgrep-linux-x64/bin/rg.
	const platformPackage = `@vscode/ripgrep-${process.platform}-${process.arch}`
	return [
		path.join(vscodeAppRoot, "node_modules/@vscode/ripgrep/bin/", binName),
		path.join(vscodeAppRoot, "node_modules/vscode-ripgrep/bin", binName),
		path.join(vscodeAppRoot, "node_modules.asar.unpacked/vscode-ripgrep/bin/", binName),
		path.join(vscodeAppRoot, "node_modules.asar.unpacked/@vscode/ripgrep/bin/", binName),
		path.join(vscodeAppRoot, `node_modules/@vscode/ripgrep-universal/${ripgrepUniversalBinDir}`, binName),
		path.join(
			vscodeAppRoot,
			`node_modules.asar.unpacked/@vscode/ripgrep-universal/${ripgrepUniversalBinDir}`,
			binName,
		),
		path.join(vscodeAppRoot, `node_modules/${platformPackage}/bin`, binName),
		path.join(vscodeAppRoot, `node_modules.asar.unpacked/${platformPackage}/bin`, binName),
	]
}

/**
 * Get the path to the ripgrep binary shipped inside the VS Code installation.
 *
 * Checks the long-standing `@vscode/ripgrep` layout, the
 * `@vscode/ripgrep-universal` layout used by VS Code Insiders' staged-install
 * builds (see microsoft/vscode#252063), and the per-platform package layout of
 * `@vscode/ripgrep` >=1.18 (VS Code 1.130+).
 *
 * Returns `undefined` when ripgrep cannot be located.
 */
export async function getBinPath(vscodeAppRoot: string): Promise<string | undefined> {
	const cliRipgrepPath = readCliRuntimeEnv(process.env).ripgrepPath
	if (cliRipgrepPath && path.isAbsolute(cliRipgrepPath) && (await fileExistsAtPath(cliRipgrepPath))) {
		return cliRipgrepPath
	}

	for (const candidate of ripgrepCandidatePaths(vscodeAppRoot)) {
		if (await fileExistsAtPath(candidate)) return candidate
	}
	return undefined
}

export async function regexSearchFiles(
	cwd: string,
	directoryPath: string,
	regex: string,
	filePattern?: string,
	rooIgnoreController?: RooIgnoreController,
): Promise<string> {
	const vscodeAppRoot = vscode.env.appRoot
	const rgPath = await getBinPath(vscodeAppRoot)

	if (!rgPath) {
		throw new Error("Could not find ripgrep binary")
	}

	const args = ["--json", "-e", regex]

	// Only add --glob if a specific file pattern is provided
	// Using --glob "*" overrides .gitignore behavior, so we omit it when no pattern is specified
	if (filePattern) {
		args.push("--glob", filePattern)
	}

	args.push("--context", "1", "--no-messages", directoryPath)

	let run: RunRipgrepResult
	try {
		run = await runRipgrep({ rgPath, args, limit: MAX_OUTPUT_LINES, timeoutMs: REGEX_SEARCH_TIMEOUT_MS })
	} catch (error) {
		throw new Error(describeSearchFailure(error, regex))
	}

	const results: SearchFileResult[] = []
	let currentFile: SearchFileResult | null = null

	run.lines.forEach((line) => {
		try {
			const parsed = JSON.parse(line)
			if (parsed.type === "begin") {
				currentFile = {
					file: parsed.data.path.text.toString(),
					searchResults: [],
				}
			} else if (parsed.type === "end") {
				// Reset the current result when a new file is encountered
				if (currentFile) results.push(currentFile)
				currentFile = null
			} else if ((parsed.type === "match" || parsed.type === "context") && currentFile) {
				const line = {
					line: parsed.data.line_number,
					text: truncateLine(parsed.data.lines.text),
					isMatch: parsed.type === "match",
					...(parsed.type === "match" && { column: parsed.data.absolute_offset }),
				}

				const lastResult = currentFile.searchResults[currentFile.searchResults.length - 1]
				if (lastResult?.lines.length > 0) {
					const lastLine = lastResult.lines[lastResult.lines.length - 1]

					// If this line is contiguous with the last result, add to it
					if (parsed.data.line_number <= lastLine.line + 1) {
						lastResult.lines.push(line)
					} else {
						// Otherwise create a new result
						currentFile.searchResults.push({
							lines: [line],
						})
					}
				} else {
					// First line in file
					currentFile.searchResults.push({
						lines: [line],
					})
				}
			}
		} catch (error) {
			console.error("Error parsing ripgrep output:", error)
		}
	})

	// The output limit or the timeout can cut a file off before its "end" record;
	// keep the matches it already had.
	const unfinishedFile = currentFile as SearchFileResult | null
	if (unfinishedFile && unfinishedFile.searchResults.length > 0) {
		results.push(unfinishedFile)
	}

	// Filter results using RooIgnoreController if provided
	const filteredResults = rooIgnoreController
		? results.filter((result) => rooIgnoreController.validateAccess(result.file))
		: results

	const formatted = formatResults(filteredResults, cwd)
	if (run.timedOut) {
		return (
			`Search timed out after ${REGEX_SEARCH_TIMEOUT_MS / 1000} s, results are incomplete. ` +
			`Narrow the path or file_pattern for a full result.\n\n${formatted}`
		)
	}
	return formatted
}

/**
 * Turns a failed ripgrep run into a short message the model can act on.
 * Weak models read this text verbatim, so it names the problem and the fix.
 */
function describeSearchFailure(error: unknown, regex: string): string {
	if (!(error instanceof RipgrepError)) {
		return `ripgrep failed: ${error instanceof Error ? error.message : String(error)}`
	}
	if (/regex parse error/i.test(error.stderr)) {
		const reason = error.stderr.match(/^error: (.+)$/m)?.[1]?.trim() ?? "the pattern is not valid"
		return (
			`Invalid regex ${JSON.stringify(regex)}: ${reason}. ` +
			"The regex uses Rust syntax: escape literal ( ) [ ] { } . * + ? | \\ with a backslash, then retry."
		)
	}
	const detail = error.stderr.trim().slice(0, 300) || error.message
	return `ripgrep failed (exit code ${error.exitCode ?? "unknown"}): ${detail}`
}

function formatResults(fileResults: SearchFileResult[], cwd: string): string {
	const groupedResults: { [key: string]: SearchResult[] } = {}

	const totalResults = fileResults.reduce((sum, file) => sum + file.searchResults.length, 0)
	let output = ""
	if (totalResults >= MAX_RESULTS) {
		output += `Showing first ${MAX_RESULTS} of ${MAX_RESULTS}+ results. Use a more specific search if necessary.\n\n`
	} else {
		output += `Found ${totalResults === 1 ? "1 result" : `${totalResults.toLocaleString()} results`}.\n\n`
	}

	// Group results by file name, showing at most MAX_RESULTS results in total
	let remaining = MAX_RESULTS
	for (const file of fileResults) {
		if (remaining <= 0) break
		const relativeFilePath = path.relative(cwd, file.file)
		if (!groupedResults[relativeFilePath]) {
			const shown = file.searchResults.slice(0, remaining)
			groupedResults[relativeFilePath] = shown
			remaining -= shown.length
		}
	}

	for (const [filePath, fileResults] of Object.entries(groupedResults)) {
		output += `# ${filePath.toPosix()}\n`

		fileResults.forEach((result) => {
			// Only show results with at least one line
			if (result.lines.length > 0) {
				// Show all lines in the result
				result.lines.forEach((line) => {
					const lineNumber = String(line.line).padStart(3, " ")
					output += `${lineNumber} | ${line.text.trimEnd()}\n`
				})
				output += "----\n"
			}
		})

		output += "\n"
	}

	return output.trim()
}
