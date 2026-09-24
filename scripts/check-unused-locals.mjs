#!/usr/bin/env node
/**
 * Type-check a package once with `--noUnusedLocals`, failing on unused locals and
 * imports only inside the folders that have been cleaned up.
 *
 * Turning `noUnusedLocals` on for a whole package at once would mean hundreds of
 * fixes (about 320 in src/ on 2026-09-24, 118 of them in core/task), so folders
 * opt in one at a time: once a folder is clean, add it to the package's
 * `check-types` script and it stays clean. Unused-local errors elsewhere are
 * counted and ignored. Every other type error fails as usual, so this replaces
 * the plain `tsc --noEmit` instead of adding a second compile.
 *
 * Usage (from the package directory, folders relative to it):
 *   node ../scripts/check-unused-locals.mjs api
 *
 * Tests: node --test 'scripts/__tests__/*.test.mjs'
 */

import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

// The diagnostics that --noUnusedLocals adds.
const UNUSED_CODES = new Set(["TS6133", "TS6138", "TS6192", "TS6196", "TS6198", "TS6199", "TS6205"])
const DIAGNOSTIC_START = /^(\S.*?)\(\d+,\d+\): error (TS\d+):/

/**
 * Split `tsc --pretty false` output into diagnostics and sort them.
 * @param {string} output
 * @param {string[]} folders folder prefixes relative to the package, e.g. ["api"]
 */
export function filterDiagnostics(output, folders) {
	const prefixes = folders.map((f) => f.replace(/\\/g, "/").replace(/\/+$/, "") + "/")
	/** @type {string[]} */
	const diagnostics = []
	for (const line of output.split(/\r?\n/)) {
		if (line === "") continue
		if (DIAGNOSTIC_START.test(line) || diagnostics.length === 0) diagnostics.push(line)
		else diagnostics[diagnostics.length - 1] += `\n${line}`
	}

	const unused = []
	const other = []
	let ignoredUnused = 0
	for (const diagnostic of diagnostics) {
		const match = DIAGNOSTIC_START.exec(diagnostic)
		if (!match || !UNUSED_CODES.has(match[2])) {
			other.push(diagnostic)
			continue
		}
		const file = match[1].replace(/\\/g, "/")
		if (prefixes.some((prefix) => file.startsWith(prefix))) unused.push(diagnostic)
		else ignoredUnused++
	}
	return { unused, other, ignoredUnused }
}

function main() {
	const folders = process.argv.slice(2)
	if (folders.length === 0) {
		console.error("usage: node check-unused-locals.mjs <folder> [folder...]")
		process.exit(2)
	}

	const tsc = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc")
	const run = spawnSync(tsc, ["--noEmit", "--noUnusedLocals", "--pretty", "false"], {
		encoding: "utf8",
		shell: process.platform === "win32",
		maxBuffer: 64 * 1024 * 1024,
	})
	if (run.error) throw run.error

	const { unused, other, ignoredUnused } = filterDiagnostics(`${run.stdout}${run.stderr}`, folders)
	for (const diagnostic of [...other, ...unused]) console.error(diagnostic)
	if (unused.length > 0) {
		console.error(
			`\n${unused.length} unused local(s) or import(s) in ${folders.join(", ")}, where noUnusedLocals is enforced.`,
		)
	}
	console.log(`(${ignoredUnused} unused local(s) outside the enforced folders were not checked.)`)
	// A non-zero tsc exit with nothing parsed (a crash, a signal) must not pass.
	const unexplainedFailure = run.status !== 0 && other.length + unused.length + ignoredUnused === 0
	if (unexplainedFailure) console.error(`tsc exited with ${run.status ?? run.signal} and no diagnostics`)
	process.exit(other.length > 0 || unused.length > 0 || unexplainedFailure ? 1 : 0)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main()
}
