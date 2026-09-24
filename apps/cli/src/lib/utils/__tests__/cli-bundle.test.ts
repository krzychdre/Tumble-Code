import { execFileSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"

import { CLI_ROOT, lockedVersions } from "./lockfile.js"

// The packages the terminal UI renders with. They must be inside the bundle,
// at the versions pnpm-lock.yaml pins, because the release installs whatever
// the CLI leaves external with `npm install` and no lockfile.
const RENDER_CRITICAL = ["ink", "react", "react-reconciler", "scheduler", "yoga-layout", "zustand"]

const HELPER = path.join(CLI_ROOT, "src/lib/utils/react-production.ts")

/**
 * Bundle `entry` (or the CLI's own entries) with the real tsup.config.ts into
 * `outDir`. It runs in a child process with the CLI as its working directory
 * because tsup reads package.json (which decides what stays external) from
 * the working directory.
 */
function bundle(outDir: string, entry?: string) {
	const script = `
const { build } = await import("tsup")
const { default: config } = await import(${JSON.stringify(pathToFileURL(path.join(CLI_ROOT, "tsup.config.ts")).href)})
const entry = process.env.PROBE_ENTRY
await build({
	...config,
	...(entry
		? {
				entry: [entry],
				// The probe lives outside the CLI, so point bare imports at the CLI's node_modules.
				esbuildOptions(options, context) {
					config.esbuildOptions?.(options, context)
					options.nodePaths = [${JSON.stringify(path.join(CLI_ROOT, "node_modules"))}]
				},
			}
		: {}),
	config: false,
	dts: false,
	sourcemap: false,
	metafile: true,
	silent: true,
	outDir: process.env.OUT_DIR,
})
`
	execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
		cwd: CLI_ROOT,
		env: { ...process.env, OUT_DIR: outDir, PROBE_ENTRY: entry ?? "" },
		encoding: "utf8",
		stdio: "pipe",
	})
}

interface Metafile {
	inputs: Record<string, unknown>
	outputs: Record<string, { imports: { path: string; external?: boolean }[] }>
}

/** Every package with files in the bundle, with the versions those files come from. */
function bundledPackages(metafile: Metafile): Map<string, Set<string>> {
	const packages = new Map<string, Set<string>>()

	for (const input of Object.keys(metafile.inputs)) {
		const match = input.match(/^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//)

		if (!match) {
			continue
		}

		const [, dir, name] = match
		const { version } = JSON.parse(fs.readFileSync(path.resolve(CLI_ROOT, dir!, "package.json"), "utf8"))
		packages.set(name!, (packages.get(name!) ?? new Set()).add(version))
	}

	return packages
}

describe("the CLI bundle", () => {
	let tmp: string

	beforeAll(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tumble-cli-bundle-"))
	})

	afterAll(() => {
		fs.rmSync(tmp, { recursive: true, force: true })
	})

	describe("with the CLI's entries", () => {
		let metafile: Metafile

		beforeAll(() => {
			const outDir = path.join(tmp, "cli")
			bundle(outDir)
			metafile = JSON.parse(fs.readFileSync(path.join(outDir, "metafile-esm.json"), "utf8"))
		})

		it("contains one copy of each render-critical package, at the version pnpm-lock.yaml pins", () => {
			const locked = lockedVersions()
			const packages = bundledPackages(metafile)

			for (const name of RENDER_CRITICAL) {
				expect({ name, versions: [...(packages.get(name) ?? [])] }).toEqual({ name, versions: [locked[name]] })
			}
		})

		it("leaves no render-critical package to be installed at run time", () => {
			const external = Object.values(metafile.outputs)
				.flatMap((output) => output.imports)
				.filter((entry) => entry.external)
				.map((entry) => entry.path)
				.filter((specifier) => RENDER_CRITICAL.some((name) => specifier === name || specifier.startsWith(`${name}/`)))

			expect([...new Set(external)].sort()).toEqual([])
		})
	})

	describe("rendering from the bundle", () => {
		let probe: string

		// The bundled counterpart of react-production.test.ts: React chooses its
		// development or production build when its bundled module first runs, so
		// the helper has to still come first once React is inside the bundle.
		beforeAll(() => {
			const source = path.join(tmp, "render-probe.ts")
			fs.writeFileSync(
				source,
				`
import { loadReactProductionBuilds } from ${JSON.stringify(HELPER.split(path.sep).join("/"))}
if (!process.env.PROBE_SKIP_HELPER) {
	await loadReactProductionBuilds()
}
const { createElement } = (await import("react")).default
const { render, Text } = await import("ink")
const { Writable } = await import("node:stream")
const stdout = Object.assign(new Writable({ write: (_chunk, _encoding, done) => done() }), { columns: 80, rows: 24 })
const Row = ({ content }: { content: string }) => createElement(Text, null, content)
const app = render(createElement(Row, { content: "x" }), { stdout: stdout as unknown as NodeJS.WriteStream, debug: true, patchConsole: false, exitOnCtrlC: false })
for (let i = 0; i < 20; i++) {
	app.rerender(createElement(Row, { content: "x".repeat(i + 2) }))
	await new Promise((resolve) => setTimeout(resolve, 5))
}
app.unmount()
console.log(JSON.stringify({ measures: performance.getEntriesByType("measure").length, nodeEnv: process.env.NODE_ENV ?? null }))
process.exit(0)
`,
			)
			const outDir = path.join(tmp, "probe")
			bundle(outDir, source)
			probe = path.join(outDir, "render-probe.js")
		})

		function run(env: { skipHelper?: boolean; nodeEnv?: string }) {
			const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: env.nodeEnv }

			if (env.nodeEnv === undefined) {
				delete childEnv.NODE_ENV
			}

			if (env.skipHelper) {
				childEnv.PROBE_SKIP_HELPER = "1"
			}

			// Run from the temporary directory, away from any node_modules.
			const output = execFileSync(process.execPath, [probe], { cwd: tmp, env: childEnv, encoding: "utf8" })
			return JSON.parse(output.trim().split("\n").at(-1)!)
		}

		it("still carries the development builds, which record a measure per render without the helper", () => {
			expect(run({ skipHelper: true }).measures).toBeGreaterThan(0)
		})

		it("renders with the production builds, which record no measures", () => {
			expect(run({})).toEqual({ measures: 0, nodeEnv: null })
		})

		it("uses the production builds even when the shell exports NODE_ENV=development, and restores it", () => {
			expect(run({ nodeEnv: "development" })).toEqual({ measures: 0, nodeEnv: "development" })
		})
	})
})
