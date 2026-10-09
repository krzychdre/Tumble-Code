#!/usr/bin/env node
/**
 * Radius guard (ai_plans/2026-10-09_ui-frame-language.md): the webview has
 * exactly two corner sizes, both defined in the `@theme` block of
 * webview-ui/src/index.css and matching VS Code: `--radius-control` (2px:
 * controls, cards, blocks) and `--radius-floating` (4px: popovers, menus,
 * dialogs, tooltips). The stock Tailwind scale is 0 and `rounded` /
 * `rounded-full` do not read it, so this check allows only the two named
 * classes and rejects:
 *
 *   - inline `borderRadius` style values other than `0` or one of the two tokens
 *   - any other `rounded*` Tailwind class (`rounded`, `rounded-full`,
 *     `hover:rounded-md`, `rounded-[3px]`, ...) outside specs and comments;
 *     `rounded-control`, `rounded-floating` and their side forms
 *     (`rounded-t-control`, `rounded-bl-floating`, ...) are allowed
 *   - CSS `border-radius` declarations in index.css other than `0`, `unset`
 *     or one of the two tokens
 *
 * Run as part of `webview-ui`'s lint script. Exits 1 listing every offender.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const webviewSrc = join(process.cwd(), "src")
const offenders = []

/** A `borderRadius:` inline style whose value is anything but plain `0`. */
const isOffendingInlineRadius = (line) =>
	/borderRadius\s*:/i.test(line) &&
	!/borderRadius\s*:\s*(?:0\s*[,}]|["'`]var\(--radius-(?:control|floating)\)["'`])/i.test(line)

/** A CSS `border-radius:` whose value is neither `0` nor `unset`. */
const isOffendingCssRadius = (line) =>
	/border-radius\s*:/i.test(line) &&
	!/border-radius\s*:\s*(?:0\s*;|unset|var\(--radius-(?:control|floating)\)\s*[;!])/i.test(line)

/** A `rounded` / `rounded-*` class token, alone or behind variants (`hover:rounded-md`). */
const roundedClass = /(^|[\s"'`{(:])rounded(-[^\s"'`})]*)?(?=[\s"'`})]|$)/g

/** The two allowed corner classes, optionally on one side or corner. */
const allowedRounded = /^rounded-(?:[trblse]{1,2}-)?(?:control|floating)$/

const hasForbiddenRounded = (line) =>
	[...line.matchAll(roundedClass)].some((match) => !allowedRounded.test(`rounded${match[2] ?? ""}`))

const isSpec = (path) => /(^|\/)__tests__\//.test(path) || /\.spec\.tsx?$/.test(path)

const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line)

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

			if (/\.tsx?$/.test(entry) && !isSpec(full) && !isComment(line) && hasForbiddenRounded(line)) {
				offenders.push(`${location}: rounded* class (use rounded-control or rounded-floating): ${line.trim()}`)
			}

			if (entry === "index.css" && isOffendingCssRadius(line)) {
				offenders.push(`${location}: non-zero CSS border-radius: ${line.trim()}`)
			}
		})
	}
}

walk(webviewSrc)

if (offenders.length > 0) {
	console.error("Radius guard: only rounded-control / rounded-floating. Offending lines:")
	for (const offender of offenders) {
		console.error(`  ${offender}`)
	}
	process.exit(1)
}
