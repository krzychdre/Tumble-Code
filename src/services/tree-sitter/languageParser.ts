import * as path from "path"
import { Parser as ParserT, Language as LanguageT, Query as QueryT } from "web-tree-sitter"
import { TREE_SITTER_GRAMMARS, hasTreeSitterGrammar } from "./languageGrammars"

export interface LanguageParser {
	[key: string]: {
		parser: ParserT
		query: QueryT
	}
}

async function loadLanguage(langName: string, sourceDirectory?: string) {
	const baseDir = sourceDirectory || __dirname
	const wasmPath = path.join(baseDir, `tree-sitter-${langName}.wasm`)

	try {
		const { Language } = require("web-tree-sitter")
		return await Language.load(wasmPath)
	} catch (error) {
		console.error(`Error loading language: ${wasmPath}: ${error instanceof Error ? error.message : error}`)
		throw error
	}
}

let isParserInitialized = false

/*
Using node bindings for tree-sitter is problematic in vscode extensions 
because of incompatibility with electron. Going the .wasm route has the 
advantage of not having to build for multiple architectures.

We use web-tree-sitter and tree-sitter-wasms which provides auto-updating
prebuilt WASM binaries for tree-sitter's language parsers.

This function loads WASM modules for relevant language parsers based on input files:
1. Extracts unique file extensions
2. Maps extensions to language names
3. Loads corresponding WASM files (containing grammar rules)
4. Uses WASM modules to initialize tree-sitter parsers

This approach optimizes performance by loading only necessary parsers once for all relevant files.

Sources:
- https://github.com/tree-sitter/node-tree-sitter/issues/169
- https://github.com/tree-sitter/node-tree-sitter/issues/168
- https://github.com/Gregoor/tree-sitter-wasms/blob/main/README.md
- https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md
- https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/test/query-test.js
*/
export async function loadRequiredLanguageParsers(filesToParse: string[], sourceDirectory?: string) {
	const { Parser, Query } = require("web-tree-sitter")

	if (!isParserInitialized) {
		try {
			await Parser.init()
			isParserInitialized = true
		} catch (error) {
			console.error(`Error initializing parser: ${error instanceof Error ? error.message : error}`)
			throw error
		}
	}

	const extensionsToLoad = new Set(filesToParse.map((file) => path.extname(file).toLowerCase().slice(1)))
	const parsers: LanguageParser = {}

	// Several extensions share a grammar (.erb/.ejs, .html/.htm, ...): load each WASM once.
	const languages = new Map<string, LanguageT>()

	for (const ext of extensionsToLoad) {
		if (!hasTreeSitterGrammar(ext)) {
			throw new Error(`Unsupported language: ${ext}`)
		}
		const grammar = TREE_SITTER_GRAMMARS[ext]

		let language = languages.get(grammar.wasm)
		if (!language) {
			language = (await loadLanguage(grammar.wasm, sourceDirectory)) as LanguageT
			languages.set(grammar.wasm, language)
		}

		const parser = new Parser()
		parser.setLanguage(language)
		// Keyed by the file's own extension: parseFile and CodeParser look parsers up that way.
		parsers[ext] = { parser, query: new Query(language, grammar.query) as QueryT }
	}

	return parsers
}
