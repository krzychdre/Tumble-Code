import { inspectTreeStructure, testParseSourceCodeDefinitions } from "./helpers"
import { javascriptQuery } from "../queries"
import sampleJsonContent from "./fixtures/sample-json"

describe("inspectJson", () => {
	const testOptions = {
		language: "javascript",
		wasmFile: "tree-sitter-javascript.wasm",
		queryString: javascriptQuery,
		extKey: "json",
	}

	it("should inspect JSON tree structure", async () => {
		// Production parses .json with the JavaScript grammar (languageGrammars.ts); the
		// JSON grammar is not shipped.
		await inspectTreeStructure(sampleJsonContent, "javascript")
	})

	it("should parse JSON definitions", async () => {
		await testParseSourceCodeDefinitions("test.json", sampleJsonContent, testOptions)
	})
})
