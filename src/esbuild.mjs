import * as esbuild from "esbuild"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"
import process from "node:process"
import * as console from "node:console"

import {
	copyPaths,
	copyWasms,
	copyLocales,
	setupLocaleWatcher,
	createBuildOptions as createSharedBuildOptions,
	createExtensionBuildOptions,
	isRunAsScript,
} from "@roo-code/build"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function removeDirWithRetries(dirPath, retries = 5, retryDelayMs = 200) {
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			await fs.promises.rm(dirPath, { recursive: true, force: true })
			return
		} catch (error) {
			const isRetryable = error?.code === "ENOTEMPTY" || error?.code === "EBUSY" || error?.code === "EPERM"
			const isLastAttempt = attempt === retries

			if (!isRetryable || isLastAttempt) {
				throw error
			}

			await new Promise((resolve) => globalThis.setTimeout(resolve, retryDelayMs * (attempt + 1)))
		}
	}
}

/**
 * The esbuild options of the release build, without plugins. Exported so a test
 * can compare them with the nightly build (apps/vscode-nightly/esbuild.mjs).
 *
 * @param {{ production?: boolean }} [options]
 * @returns {{ extension: import('esbuild').BuildOptions, worker: import('esbuild').BuildOptions }}
 */
export function createBuildOptions({ production = false } = {}) {
	// Always generate source maps for error handling.
	return {
		extension: {
			...createExtensionBuildOptions({ production, sourcemap: true, srcDir: __dirname }),
			entryPoints: ["extension.ts"],
			outfile: "dist/extension.js",
		},
		worker: {
			...createSharedBuildOptions({ production, sourcemap: true }),
			entryPoints: ["workers/countTokens.ts"],
			outdir: "dist/workers",
		},
	}
}

async function main() {
	const name = "extension"
	const production = process.argv.includes("--production")
	const watch = process.argv.includes("--watch")
	const { extension, worker } = createBuildOptions({ production })

	const srcDir = __dirname
	const buildDir = __dirname
	const distDir = path.join(buildDir, "dist")

	if (fs.existsSync(distDir)) {
		console.log(`[${name}] Cleaning dist directory: ${distDir}`)
		await removeDirWithRetries(distDir)
	}

	/**
	 * @type {import('esbuild').Plugin[]}
	 */
	const plugins = [
		{
			name: "copyFiles",
			setup(build) {
				build.onEnd(() => {
					copyPaths(
						[
							["../README.md", "README.md"],
							["../CHANGELOG.md", "CHANGELOG.md"],
							["../LICENSE", "LICENSE"],
							["../.env", ".env", { optional: true }],
							["node_modules/vscode-material-icons/generated", "assets/vscode-material-icons"],
							["../webview-ui/audio", "webview-ui/audio"],
						],
						srcDir,
						buildDir,
					)
				})
			},
		},
		{
			name: "copyWasms",
			setup(build) {
				build.onEnd(() => copyWasms(srcDir, distDir))
			},
		},
		{
			name: "copyLocales",
			setup(build) {
				build.onEnd(() => copyLocales(srcDir, distDir))
			},
		},
		{
			name: "esbuild-problem-matcher",
			setup(build) {
				build.onStart(() => console.log("[esbuild-problem-matcher#onStart]"))
				build.onEnd((result) => {
					result.errors.forEach(({ text, location }) => {
						console.error(`✘ [ERROR] ${text}`)
						if (location && location.file) {
							console.error(`    ${location.file}:${location.line}:${location.column}:`)
						}
					})

					console.log("[esbuild-problem-matcher#onEnd]")
				})
			},
		},
	]

	/**
	 * @type {import('esbuild').BuildOptions}
	 */
	const extensionConfig = { ...extension, plugins }

	/**
	 * @type {import('esbuild').BuildOptions}
	 */
	const workerConfig = worker

	const [extensionCtx, workerCtx] = await Promise.all([
		esbuild.context(extensionConfig),
		esbuild.context(workerConfig),
	])

	if (watch) {
		await Promise.all([extensionCtx.watch(), workerCtx.watch()])
		copyLocales(srcDir, distDir)
		setupLocaleWatcher(srcDir, distDir)
	} else {
		await Promise.all([extensionCtx.rebuild(), workerCtx.rebuild()])
		await Promise.all([extensionCtx.dispose(), workerCtx.dispose()])
	}
}

// Build only when run as a script (`node esbuild.mjs`), not when a test imports this file.
if (isRunAsScript(import.meta.url)) {
	main().catch((e) => {
		console.error(e)
		process.exit(1)
	})
}
