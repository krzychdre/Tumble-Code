import {
	javascriptQuery,
	typescriptQuery,
	tsxQuery,
	pythonQuery,
	rustQuery,
	goQuery,
	cppQuery,
	cQuery,
	csharpQuery,
	rubyQuery,
	javaQuery,
	phpQuery,
	htmlQuery,
	swiftQuery,
	kotlinQuery,
	cssQuery,
	ocamlQuery,
	solidityQuery,
	tomlQuery,
	vueQuery,
	luaQuery,
	systemrdlQuery,
	tlaPlusQuery,
	zigQuery,
	embeddedTemplateQuery,
	elispQuery,
	elixirQuery,
} from "./queries"

export interface TreeSitterGrammar {
	/** Grammar name: the WASM file is `tree-sitter-<wasm>.wasm` in the dist directory. */
	wasm: string
	/** Tag query run against the parse tree. */
	query: string
}

/**
 * Extension (lowercase, without the dot) -> grammar used to parse it.
 *
 * The loader stores each parser under the file's own extension, which is the
 * key parseFile (definitions listing) and CodeParser (code index) look it up
 * by, so several extensions may share one grammar without any aliasing.
 *
 * Extensions advertised in index.ts but missing here have no usable grammar
 * and must be listed in the code index fallbackExtensions:
 * - vb: no Visual Basic WASM ships in tree-sitter-wasms.
 * - elm: tree-sitter-elm.wasm ships, but it is ABI 12 and web-tree-sitter
 *   0.25 only accepts ABI 13 to 15, so Parser.setLanguage rejects it.
 */
export const TREE_SITTER_GRAMMARS: Readonly<Record<string, TreeSitterGrammar>> = {
	js: { wasm: "javascript", query: javascriptQuery },
	jsx: { wasm: "javascript", query: javascriptQuery },
	json: { wasm: "javascript", query: javascriptQuery },
	ts: { wasm: "typescript", query: typescriptQuery },
	tsx: { wasm: "tsx", query: tsxQuery },
	py: { wasm: "python", query: pythonQuery },
	rs: { wasm: "rust", query: rustQuery },
	go: { wasm: "go", query: goQuery },
	cpp: { wasm: "cpp", query: cppQuery },
	hpp: { wasm: "cpp", query: cppQuery },
	c: { wasm: "c", query: cQuery },
	h: { wasm: "c", query: cQuery },
	cs: { wasm: "c_sharp", query: csharpQuery },
	rb: { wasm: "ruby", query: rubyQuery },
	java: { wasm: "java", query: javaQuery },
	php: { wasm: "php", query: phpQuery },
	swift: { wasm: "swift", query: swiftQuery },
	kt: { wasm: "kotlin", query: kotlinQuery },
	kts: { wasm: "kotlin", query: kotlinQuery },
	css: { wasm: "css", query: cssQuery },
	html: { wasm: "html", query: htmlQuery },
	htm: { wasm: "html", query: htmlQuery },
	ml: { wasm: "ocaml", query: ocamlQuery },
	mli: { wasm: "ocaml", query: ocamlQuery },
	// Temporarily uses the Lua query until a Scala query is implemented.
	scala: { wasm: "scala", query: luaQuery },
	sol: { wasm: "solidity", query: solidityQuery },
	toml: { wasm: "toml", query: tomlQuery },
	vue: { wasm: "vue", query: vueQuery },
	lua: { wasm: "lua", query: luaQuery },
	rdl: { wasm: "systemrdl", query: systemrdlQuery },
	tla: { wasm: "tlaplus", query: tlaPlusQuery },
	zig: { wasm: "zig", query: zigQuery },
	ejs: { wasm: "embedded_template", query: embeddedTemplateQuery },
	erb: { wasm: "embedded_template", query: embeddedTemplateQuery },
	el: { wasm: "elisp", query: elispQuery },
	ex: { wasm: "elixir", query: elixirQuery },
	exs: { wasm: "elixir", query: elixirQuery },
}

/** True when `ext` (lowercase, with or without the leading dot) has a tree-sitter grammar. */
export function hasTreeSitterGrammar(ext: string): boolean {
	return Object.hasOwn(TREE_SITTER_GRAMMARS, ext.startsWith(".") ? ext.slice(1) : ext)
}
