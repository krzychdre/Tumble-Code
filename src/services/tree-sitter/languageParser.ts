import * as path from "path"
import { Parser as ParserT, Language as LanguageT, Query as QueryT } from "web-tree-sitter"
import { TREE_SITTER_GRAMMARS, hasTreeSitterGrammar } from "./languageGrammars"

export interface LanguageParser {
	[key: string]: {
		parser: ParserT
		query: QueryT
	}
}

async function loadLanguage(wasmPath: string) {
	try {
		// Lazy CJS require: web-tree-sitter's WASM bootstrap is expensive, keep
		// it out of module-load time.
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { Language } = require("web-tree-sitter")
		return await Language.load(wasmPath)
	} catch (error) {
		console.error(`Error loading language: ${wasmPath}: ${error instanceof Error ? error.message : error}`)
		throw error
	}
}

let parserInit: Promise<void> | undefined

function initParser(): Promise<void> {
	if (!parserInit) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { Parser } = require("web-tree-sitter")
		parserInit = (Parser.init() as Promise<void>).catch((error: unknown) => {
			parserInit = undefined
			console.error(`Error initializing parser: ${error instanceof Error ? error.message : error}`)
			throw error
		})
	}
	return parserInit
}

/**
 * One loaded grammar: its Language, one Parser bound to it, and the tag
 * queries compiled against it (keyed by query source).
 *
 * Sharing one Parser between callers is safe because Parser.parse() is
 * synchronous in web-tree-sitter 0.25: a caller that has the parser runs
 * parse() to completion before any other caller can run, and the returned
 * Tree does not depend on the parser afterwards. The parser is bound to its
 * language once here and never switched.
 */
interface GrammarEntry {
	language: LanguageT
	parser: ParserT
	queries: Map<string, QueryT>
}

interface CacheSlot {
	promise: Promise<GrammarEntry>
	/** Set once the load has finished, so dispose can release it right away. */
	entry?: GrammarEntry
}

/** Keyed by the absolute WASM path, so different source directories never mix. */
const grammarCache = new Map<string, CacheSlot>()

function getGrammar(wasmPath: string): Promise<GrammarEntry> {
	const cached = grammarCache.get(wasmPath)
	if (cached) {
		return cached.promise
	}

	const slot = {} as CacheSlot
	slot.promise = (async () => {
		const language = (await loadLanguage(wasmPath)) as LanguageT
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { Parser } = require("web-tree-sitter")
		const parser: ParserT = new Parser()
		try {
			parser.setLanguage(language)
		} catch (error) {
			parser.delete()
			throw error
		}
		const entry: GrammarEntry = { language, parser, queries: new Map() }
		slot.entry = entry
		return entry
	})()
	grammarCache.set(wasmPath, slot)

	// A failed load is not cached: the next call tries again.
	slot.promise.catch(() => {
		if (grammarCache.get(wasmPath) === slot) {
			grammarCache.delete(wasmPath)
		}
	})

	return slot.promise
}

function getQuery(grammar: GrammarEntry, source: string): QueryT {
	let query = grammar.queries.get(source)
	if (!query) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { Query } = require("web-tree-sitter")
		query = new Query(grammar.language, source) as QueryT
		grammar.queries.set(source, query)
	}
	return query
}

/**
 * Releases every cached Parser and Query (their memory lives in the WASM
 * heap, which the JS garbage collector never frees). Called on extension
 * deactivate; the next loadRequiredLanguageParsers call loads again.
 *
 * web-tree-sitter 0.25 has no Language.delete(): a loaded grammar module
 * stays in the WASM runtime, so only our references to it are dropped.
 * A load still in flight is dropped from the cache but not deleted, because
 * the caller awaiting it is about to use its parser.
 */
export function disposeLanguageParsers(): void {
	const slots = [...grammarCache.values()]
	grammarCache.clear()

	for (const { entry } of slots) {
		if (!entry) continue
		for (const query of entry.queries.values()) {
			query.delete()
		}
		entry.parser.delete()
	}
}

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

Each grammar is loaded once per extension host and cached (see getGrammar);
disposeLanguageParsers releases the cache on deactivate.

Sources:
- https://github.com/tree-sitter/node-tree-sitter/issues/169
- https://github.com/tree-sitter/node-tree-sitter/issues/168
- https://github.com/Gregoor/tree-sitter-wasms/blob/main/README.md
- https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md
- https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/test/query-test.js
*/
export async function loadRequiredLanguageParsers(filesToParse: string[], sourceDirectory?: string) {
	await initParser()

	const baseDir = sourceDirectory || __dirname
	const extensionsToLoad = new Set(filesToParse.map((file) => path.extname(file).toLowerCase().slice(1)))
	const parsers: LanguageParser = {}

	for (const ext of extensionsToLoad) {
		if (!hasTreeSitterGrammar(ext)) {
			throw new Error(`Unsupported language: ${ext}`)
		}
		const { wasm, query } = TREE_SITTER_GRAMMARS[ext]

		// Cached per grammar: several extensions share one (.erb/.ejs, .html/.htm, ...),
		// and the definitions listing calls this once per file it reads.
		const grammar = await getGrammar(path.join(baseDir, `tree-sitter-${wasm}.wasm`))

		// Keyed by the file's own extension: parseFile and CodeParser look parsers up that way.
		parsers[ext] = { parser: grammar.parser, query: getQuery(grammar, query) }
	}

	return parsers
}
