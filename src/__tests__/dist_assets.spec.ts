// npx vitest __tests__/dist_assets.spec.ts

import * as fs from "fs"
import * as path from "path"

import { TREE_SITTER_GRAMMARS } from "../services/tree-sitter/languageGrammars"

describe("dist assets", () => {
	const distPath = path.join(__dirname, "../dist")

	describe("tiktoken", () => {
		it("should have tiktoken wasm file", () => {
			expect(fs.existsSync(path.join(distPath, "tiktoken_bg.wasm"))).toBe(true)
		})
	})

	describe("tree-sitter", () => {
		// The build copies exactly the grammars the grammar table can load
		// (grammar-wasms.json, kept in sync with the table by grammarWasms.spec.ts).
		const treeSitterFiles = [
			"tree-sitter.wasm",
			...[...new Set(Object.values(TREE_SITTER_GRAMMARS).map(({ wasm }) => `tree-sitter-${wasm}.wasm`))].sort(),
		]

		test.each(treeSitterFiles)("should have %s file", (filename) => {
			expect(fs.existsSync(path.join(distPath, filename))).toBe(true)
		})
	})
})
