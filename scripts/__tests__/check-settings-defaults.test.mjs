import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { checkSettingsDefaults } from "../check-settings-defaults.mjs"

const TABLE = `import { DEFAULT_X } from "./x.js"
const settingsDefaults = {
\tkeyA: true,
\tkeyB: 100,
\tkeyC: "default",
\tcurrentApiConfigName: "default",
} satisfies Shape
export const SETTINGS_DEFAULTS = deepFreeze(settingsDefaults)
`

function makeTree() {
	const root = mkdtempSync(join(tmpdir(), "check-settings-defaults-"))
	mkdirSync(join(root, "packages/types/src"), { recursive: true })
	writeFileSync(join(root, "packages/types/src/settings-defaults.ts"), TABLE)
	mkdirSync(join(root, "src"), { recursive: true })
	return root
}

test("parses the table keys", () => {
	const root = makeTree()
	try {
		const { keys } = checkSettingsDefaults({ root })
		assert.ok(keys.has("keyA"))
		assert.ok(keys.has("keyB"))
		assert.ok(keys.has("keyC"))
		assert.equal(keys.size, 4)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("flags a literal default on a table key", () => {
	const root = makeTree()
	try {
		writeFileSync(
			join(root, "src/a.ts"),
			"export const f = (state) => {\n\tconst { keyA = true } = state ?? {}\n\treturn keyA\n}\n",
		)
		const { violations } = checkSettingsDefaults({ root })
		assert.equal(violations.length, 1)
		assert.equal(violations[0].key, "keyA")
		assert.match(violations[0].file, /src\/a\.ts$/)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("flags ?? and || literal fallbacks too", () => {
	const root = makeTree()
	try {
		writeFileSync(join(root, "src/b.ts"), "export const g = (s) => s.keyB ?? 100\n")
		writeFileSync(join(root, "src/c.ts"), 'export const h = (s) => s?.keyC || "default"\n')
		const { violations } = checkSettingsDefaults({ root })
		assert.equal(violations.length, 2)
		assert.ok(violations.some((v) => v.key === "keyB"))
		assert.ok(violations.some((v) => v.key === "keyC"))
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("SETTINGS_DEFAULTS references pass, plain assignments do not match", () => {
	const root = makeTree()
	try {
		writeFileSync(
			join(root, "src/d.ts"),
			'import { SETTINGS_DEFAULTS } from "x"\n' +
				"export const f = (state) => {\n" +
				"\tconst { keyA = SETTINGS_DEFAULTS.keyA } = state ?? {}\n" +
				"\ttask.keyB = false // a write, not a default\n" +
				"\treturn keyA\n}\n",
		)
		const { violations } = checkSettingsDefaults({ root })
		assert.equal(violations.length, 0)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("non-table keys may default freely", () => {
	const root = makeTree()
	try {
		writeFileSync(join(root, "src/e.ts"), "export const f = ({ other = 5 }) => other\n")
		const { violations } = checkSettingsDefaults({ root })
		assert.equal(violations.length, 0)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("scans the webview-ui workspace too", () => {
	const root = makeTree()
	try {
		mkdirSync(join(root, "webview-ui/src/components"), { recursive: true })
		writeFileSync(join(root, "webview-ui/src/components/a.ts"), "export const f = (s) => s.keyA ?? true\n")
		const { violations } = checkSettingsDefaults({ root })
		assert.equal(violations.length, 1)
		assert.equal(violations[0].key, "keyA")
		assert.match(violations[0].file, /webview-ui\/src\/components\/a\.ts$/)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

// An allowlisted exception of the real ALLOWED table.
const TOOLBAR = "webview-ui/src/components/chat/ComposerToolbar.tsx"
const TOOLBAR_EXCEPTION = '\t\t\tdisplayName: currentApiConfigName || "",\n'

function writeToolbar(root, body) {
	mkdirSync(join(root, "webview-ui/src/components/chat"), { recursive: true })
	writeFileSync(join(root, TOOLBAR), body)
}

test("an allowlisted exception survives edits above it, a second occurrence in the file is flagged", () => {
	const root = makeTree()
	try {
		writeToolbar(root, "// added\n// lines\n" + TOOLBAR_EXCEPTION)
		assert.deepEqual(checkSettingsDefaults({ root }).violations, [])

		writeToolbar(root, TOOLBAR_EXCEPTION + "\n" + TOOLBAR_EXCEPTION)
		const { violations } = checkSettingsDefaults({ root })
		assert.equal(violations.length, 1)
		assert.equal(violations[0].line, 3)
		assert.equal(violations[0].expression, 'currentApiConfigName || ""')
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("an allowlist entry whose exception was removed is reported as stale", () => {
	const root = makeTree()
	try {
		writeToolbar(root, TOOLBAR_EXCEPTION)
		assert.ok(!checkSettingsDefaults({ root }).stale.includes(`${TOOLBAR}: currentApiConfigName || ""`))

		writeToolbar(root, "\t\t\tdisplayName: currentApiConfigName,\n")
		assert.ok(checkSettingsDefaults({ root }).stale.includes(`${TOOLBAR}: currentApiConfigName || ""`))
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("the real repo tree is clean", () => {
	const { keys, violations, stale } = checkSettingsDefaults()
	assert.ok(keys.size > 50, "expected the real table to have dozens of keys")
	assert.deepEqual(violations, [])
	assert.deepEqual(stale, [])
})
