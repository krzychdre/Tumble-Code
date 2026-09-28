#!/usr/bin/env node
/**
 * Radius guard (§2.2, ai_plans/2026-09-27_ui-modernization.md): the webview
 * renders square corners from one place — the `@theme` radius scale plus the
 * flattened `rounded-*` utility layer in webview-ui/src/index.css. This check
 * rejects new hard-coded corner radii anywhere else in the webview source:
 *
 *   - inline `borderRadius` style values (any value other than `0`)
 *   - arbitrary Tailwind radius literals like `rounded-[3px]`
 *   - CSS `border-radius` declarations with a non-zero value in index.css
 *     (the `rounded-*` flattening layer itself is exempt)
 *
 * Run as part of `webview-ui`'s lint script. Exits 1 listing every offender.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const webviewSrc = join(process.cwd(), "src")
const offenders = []

/** A `borderRadius:` inline style whose value is anything but plain `0`. */
const isOffendingInlineRadius = (line) =>
	/borderRadius\s*:/i.test(line) && !/borderRadius\s*:\s*0\s*[,}]/i.test(line)

/** A CSS `border-radius:` whose value is neither `0` nor `unset`. */
const isOffendingCssRadius = (line) =>
	/border-radius\s*:/i.test(line) && !/border-radius\s*:\s*(?:0\s*;|unset)/i.test(line)

const walk = (dir) => {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) {
			walk(full)
			continue
		}

		if (!/\.(tsx?|css)$/.test(entry)) continue
		if (entry.endsWith(".d.ts")) continue

		const lines = readFileSync(full, "utf8").split("\n")

		lines.forEach((line, index) => {
			const location = `${full}:${index + 1}`

			if (isOffendingInlineRadius(line)) {
				offenders.push(`${location}: hard-coded borderRadius: ${line.trim()}`)
			}

			if (/rounded-\[/.test(line)) {
				offenders.push(`${location}: arbitrary rounded-[...] literal: ${line.trim()}`)
			}

			if (entry === "index.css" && isOffendingCssRadius(line)) {
				offenders.push(`${location}: non-zero CSS border-radius: ${line.trim()}`)
			}
		})
	}
}

walk(webviewSrc)

if (offenders.length > 0) {
	console.error("Radius guard: square corners only. Offending lines:")
	for (const offender of offenders) {
		console.error(`  ${offender}`)
	}
	process.exit(1)
}
