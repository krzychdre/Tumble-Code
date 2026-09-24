import * as fs from "fs"

/**
 * Modules the extension bundle loads at runtime instead of bundling them.
 *
 * - `vscode` is provided by the extension host.
 * - `global-agent` must stay external because it dynamically patches Node.js
 *   http/https modules, which breaks when bundled. It needs access to the actual
 *   Node.js module instances.
 * - `esbuild` and `@vscode/ripgrep` ship native binaries that cannot be bundled.
 *
 * undici, by contrast, must be bundled because the VSIX is packaged with
 * `--no-dependencies`.
 */
export const extensionExternals: readonly string[] = Object.freeze([
	"vscode",
	"esbuild",
	"global-agent",
	"@vscode/ripgrep",
])

export const extensionAliases: Readonly<Record<string, string>> = Object.freeze({
	// Node gives its deprecated built-in `punycode` module precedence over the
	// package with the same name. The trailing slash selects Punycode.js.
	punycode: "punycode/",
})

/**
 * The subset of esbuild's `BuildOptions` produced here. This package does not
 * depend on esbuild, so the type is spelled out instead of imported.
 */
export interface ExtensionBuildOptions {
	bundle: true
	minify: boolean
	sourcemap: boolean
	logLevel: "silent"
	format: "cjs"
	sourcesContent: false
	platform: "node"
	define?: Record<string, string>
}

export interface CreateBuildOptionsArgs {
	/** Minify the output (`--production`). */
	production?: boolean
	/** Emit source maps. Defaults to `true`: they are needed to map error stacks. */
	sourcemap?: boolean
	/** Compile-time constants, e.g. the nightly package name and version. */
	define?: Record<string, string>
}

/**
 * The esbuild options shared by every bundle of the extension (the extension
 * itself and its workers), for both the release build (src/esbuild.mjs) and
 * the nightly build (apps/vscode-nightly/esbuild.mjs).
 */
export function createBuildOptions({
	production = false,
	sourcemap = true,
	define,
}: CreateBuildOptionsArgs = {}): ExtensionBuildOptions {
	return {
		bundle: true,
		minify: production,
		sourcemap,
		logLevel: "silent",
		format: "cjs",
		sourcesContent: false,
		platform: "node",
		...(define ? { define } : {}),
	}
}

/**
 * The esbuild options of the extension entry point: the shared options plus the
 * externals and aliases the extension needs. Both the release and the nightly
 * build must use this so their bundles cannot drift apart again (DEF-C30).
 */
export function createExtensionBuildOptions({
	srcDir,
	...args
}: CreateBuildOptionsArgs & {
	/** The extension package directory (src/), where its dependencies are installed. */
	srcDir: string
}): ExtensionBuildOptions & { absWorkingDir: string; alias: Record<string, string>; external: string[] } {
	return {
		...createBuildOptions(args),
		// esbuild resolves alias targets (`punycode/`) from the working directory,
		// not from the importing file, so it must be the package that depends on
		// punycode, whatever directory the build script is started from.
		absWorkingDir: srcDir,
		alias: { ...extensionAliases },
		external: [...extensionExternals],
	}
}

/**
 * Whether the module with URL `moduleUrl` (pass `import.meta.url`) is the
 * script Node was started with, as opposed to a module imported by a test.
 * Symlinks are resolved on both sides so a symlinked checkout still builds.
 */
export function isRunAsScript(moduleUrl: string): boolean {
	const script = process.argv[1]

	if (!script) {
		return false
	}

	try {
		return fs.realpathSync(script) === fs.realpathSync(new URL(moduleUrl))
	} catch {
		return false
	}
}
