// The build copies only the grammar WASMs listed in grammar-wasms.json (the
// build package cannot import this TypeScript table, so the release and
// nightly build scripts read the JSON and pass it to copyWasms). If a grammar
// is added to or removed from languageGrammars.ts without updating the JSON,
// the extension would look for a WASM the build never copied, or ship one
// nobody loads.

import * as fs from "fs"
import * as path from "path"

import grammarWasms from "../grammar-wasms.json"
import { TREE_SITTER_GRAMMARS } from "../languageGrammars"

describe("grammar-wasms.json (tree-sitter grammars copied by the build)", () => {
	it("matches the grammars in the extension's grammar table", () => {
		const registered = [...new Set(Object.values(TREE_SITTER_GRAMMARS).map(({ wasm }) => wasm))].sort()

		expect([...grammarWasms].sort()).toEqual(registered)
	})

	it("names only grammars that tree-sitter-wasms ships", () => {
		const outDir = path.join(path.dirname(require.resolve("tree-sitter-wasms/package.json")), "out")
		const missing = grammarWasms.filter((name) => !fs.existsSync(path.join(outDir, `tree-sitter-${name}.wasm`)))

		expect(missing).toEqual([])
	})
})
