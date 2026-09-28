// D15: the shared vitest preset. Pins the settings every workspace inherits and
// the merge rules the workspace configs rely on (arrays add, objects merge).
//
// Run: node --test __tests__/ (from packages/config-vitest).

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { configDefaults } from "vitest/config"

import { defineRooVitestConfig, resolveVerbosity, sharedTestConfig } from "../index.js"

describe("defineRooVitestConfig", () => {
	it("returns the shared settings when a workspace passes nothing", () => {
		const config = defineRooVitestConfig()

		assert.equal(config.test.globals, true)
		assert.equal(config.test.environment, "node")
		assert.equal(config.test.watch, false)
		assert.deepEqual(config.test.exclude, [...configDefaults.exclude, "**/dist/**"])
	})

	it("lets a workspace override a scalar (webview-ui runs under jsdom)", () => {
		const config = defineRooVitestConfig({ test: { environment: "jsdom" } })

		assert.equal(config.test.environment, "jsdom")
		assert.equal(config.test.globals, true)
	})

	it("adds workspace-specific fields next to the shared ones", () => {
		const alias = { vscode: "/mocks/vscode.ts" }
		const config = defineRooVitestConfig({
			test: { testTimeout: 30_000, hookTimeout: 30_000, include: ["src/**/*.test.ts"] },
			resolve: { alias },
		})

		assert.equal(config.test.testTimeout, 30_000)
		assert.equal(config.test.hookTimeout, 30_000)
		assert.deepEqual(config.test.include, ["src/**/*.test.ts"])
		assert.deepEqual(config.resolve.alias, alias)
		assert.equal(config.test.watch, false)
	})

	it("appends an extra exclude to the shared one instead of replacing it", () => {
		const config = defineRooVitestConfig({ test: { exclude: ["**/fixtures/**"] } })

		assert.deepEqual(config.test.exclude, [...configDefaults.exclude, "**/dist/**", "**/fixtures/**"])
	})

	it("does not mutate the shared settings between calls", () => {
		defineRooVitestConfig({ test: { exclude: ["**/one/**"], environment: "jsdom" } })

		assert.deepEqual(sharedTestConfig.exclude, [...configDefaults.exclude, "**/dist/**"])
		assert.equal(sharedTestConfig.environment, "node")
		assert.deepEqual(defineRooVitestConfig().test.exclude, [...configDefaults.exclude, "**/dist/**"])
	})
})

describe("resolveVerbosity", () => {
	it("is silent with the dot reporter by default", () => {
		const v = resolveVerbosity(["node", "vitest", "run"], {})

		assert.equal(v.silent, true)
		assert.deepEqual(v.reporters, ["dot"])
	})

	it("keeps stderr and drops stdout while silent", () => {
		const v = resolveVerbosity(["node", "vitest", "run"], {})

		assert.equal(v.onConsoleLog("warning", "stderr"), undefined)
		assert.equal(v.onConsoleLog("info", "stdout"), false)
	})

	it("shows everything with --no-silent or --silent=false", () => {
		for (const flag of ["--no-silent", "--silent=false"]) {
			const v = resolveVerbosity(["node", "vitest", "run", flag], {})

			assert.equal(v.silent, false)
			assert.equal(v.onConsoleLog("info", "stdout"), undefined)
		}
	})

	it("adds the verbose reporter when asked for it", () => {
		const v = resolveVerbosity(["node", "vitest", "run", "--reporter=verbose"], {})

		assert.deepEqual(v.reporters, ["dot", "verbose"])
	})

	it("adds the github-actions reporter on GitHub Actions", () => {
		const v = resolveVerbosity(["node", "vitest", "run"], { GITHUB_ACTIONS: "true" })

		assert.deepEqual(v.reporters, ["dot", "github-actions"])
	})
})
