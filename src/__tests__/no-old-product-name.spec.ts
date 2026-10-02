// npx vitest run __tests__/no-old-product-name.spec.ts
//
// The fork may not use the old CamelCase product name any more, in any form:
// identifiers, User-Agent headers, URLs, comments, test data. The pattern is
// assembled from parts so this file does not trip its own check.

import { execFileSync } from "child_process"
import fs from "fs"
import path from "path"

const repoRoot = path.resolve(__dirname, "..", "..")

const OLD_NAME = new RegExp(["roo", "code"].join(""), "i")

// Paths that may keep the old name, and why.
const ALLOWED = [
	// Plan documents are the project's history and quote it as it was.
	/^ai_plans\//,
	// The upstream era of the release history.
	/^CHANGELOG\.md$/,
	// Attribution: the "fork of Roo Code" sentence links the upstream repository.
	/^README\.md$/,
	/^CONTRIBUTING\.md$/,
	// The globalState key that marks the one-shot import from the old extension
	// as done. It is stored on users' machines; renaming it would run the import
	// again and overwrite their task history.
	/^src\/utils\/migrateFromRooCline\.ts$/,
	/^src\/utils\/__tests__\/migrateFromRooCline\.spec\.ts$/,
]

describe("old product name", () => {
	it("appears in no tracked file outside the allowed list", () => {
		const files = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
			.split("\0")
			.filter((file) => file && !ALLOWED.some((pattern) => pattern.test(file)))

		const offenders = files.filter((file) => {
			const full = path.join(repoRoot, file)
			if (OLD_NAME.test(file)) return true
			if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return false
			const content = fs.readFileSync(full)
			// Skip binary files (images, fonts).
			if (content.includes(0)) return false
			return OLD_NAME.test(content.toString("utf8"))
		})

		expect(offenders).toEqual([])
	})
})
