// PKG-2: lint rules that keep workspace boundaries intact.
//
// 1. A relative import must stay inside the workspace (the nearest package.json)
//    of the file that writes it. `../../../src/...` from a package reaches into
//    another workspace's source behind the dependency graph: pnpm, turbo and
//    knip cannot see the edge, so caches go stale and the dependency is never
//    declared.
// 2. Files in src/shared are bundled into the webview through the `@roo/*`
//    alias, so they must not import `vscode` (the TEST-8 bundle guard is the
//    runtime backstop).
//
// The cases lint in-memory code through ESLint's Node API against the real
// workspace configs (src/eslint.config.mjs, webview-ui/eslint.config.mjs), so
// they check the wiring as well as the rule itself.
//
// Run: node --test __tests__/ (from packages/config-eslint).

import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "node:test"

import { ESLint } from "eslint"

const repoRoot = path.resolve(import.meta.dirname, "../../..")
const BOUNDARY_RULE = "boundaries/no-relative-import-outside-package"

async function lint(workspace, relativeFile, code) {
	const cwd = path.join(repoRoot, workspace)
	const eslint = new ESLint({ cwd })
	const [result] = await eslint.lintText(code, { filePath: path.join(cwd, relativeFile) })
	return result.messages
}

function ruleIds(messages) {
	return messages.map((message) => message.ruleId)
}

describe("relative imports that leave the workspace", () => {
	it("rejects an extension file importing another package's source by path", async () => {
		const messages = await lint(
			"src",
			"services/example/example.ts",
			'import { TelemetryService } from "../../../packages/telemetry/src/TelemetryService"\nexport const t = TelemetryService\n',
		)
		assert.ok(ruleIds(messages).includes(BOUNDARY_RULE), JSON.stringify(messages))
	})

	it("rejects a vi.mock of another package's source by path", async () => {
		const messages = await lint(
			"src",
			"services/example/__tests__/example.spec.ts",
			'vi.mock("../../../../packages/telemetry/src/TelemetryService", () => ({}))\n',
		)
		assert.ok(ruleIds(messages).includes(BOUNDARY_RULE), JSON.stringify(messages))
	})

	it("rejects a webview file reaching into ../src/shared by path", async () => {
		const messages = await lint(
			"webview-ui",
			"src/components/example/Example.ts",
			'import type { WebviewMessage } from "../../../../src/shared/WebviewMessage"\nexport type M = WebviewMessage\n',
		)
		assert.ok(ruleIds(messages).includes(BOUNDARY_RULE), JSON.stringify(messages))
	})

	it("rejects re-exports and dynamic imports that leave a package", async () => {
		const messages = await lint(
			"packages/core",
			"src/example.ts",
			'export * from "../../types/src/index"\nexport const later = () => import("../../../src/shared/array")\n',
		)
		assert.equal(ruleIds(messages).filter((id) => id === BOUNDARY_RULE).length, 2, JSON.stringify(messages))
	})

	it("accepts relative imports inside the package and package-name imports", async () => {
		const messages = await lint(
			"src",
			"services/example/example.ts",
			[
				'import { a } from "./a"',
				'import { b } from "../../shared/array"',
				'import { TelemetryService } from "@roo-code/telemetry"',
				'vi.mock("@roo-code/telemetry", () => ({}))',
				"export const all = [a, b, TelemetryService]",
				"",
			].join("\n"),
		)
		assert.deepEqual(ruleIds(messages), [], JSON.stringify(messages))
	})
})

describe("vscode imports in src/shared (bundled into the webview)", () => {
	it("rejects a vscode import in a shared file", async () => {
		const messages = await lint(
			"src",
			"shared/example.ts",
			'import * as vscode from "vscode"\nexport const w = vscode.window\n',
		)
		assert.ok(ruleIds(messages).includes("no-restricted-imports"), JSON.stringify(messages))
	})

	it("accepts a vscode import outside src/shared", async () => {
		const messages = await lint(
			"src",
			"core/example.ts",
			'import * as vscode from "vscode"\nexport const w = vscode.window\n',
		)
		assert.deepEqual(ruleIds(messages), [], JSON.stringify(messages))
	})

	it("accepts a vscode import in a shared spec (specs never reach the webview bundle)", async () => {
		const messages = await lint(
			"src",
			"shared/__tests__/example.spec.ts",
			'import * as vscode from "vscode"\nexport const w = vscode.window\n',
		)
		assert.deepEqual(ruleIds(messages), [], JSON.stringify(messages))
	})
})
