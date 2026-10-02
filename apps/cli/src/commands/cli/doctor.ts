/**
 * `tumble doctor` (UI plan §4): check what a session needs before starting
 * one. Each check prints one line, `[pass]`, `[warn]` or `[fail]`, and the
 * command exits with 1 when any check failed.
 *
 * - fail: the CLI cannot work (no extension bundle, no ripgrep, Node too old,
 *   an MCP file the extension will reject);
 * - warn: something optional is missing (the cloud is unreachable; sessions
 *   still run, only sharing and remote control are offline).
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

import { execa } from "execa"
import { readCliRuntimeEnv } from "@tumble-code/types"

import { getCliPackageRoot } from "@/lib/utils/cli-root.js"
import { getDefaultExtensionPath } from "@/lib/utils/extension.js"
import { isRecord } from "@/lib/utils/guards.js"
import { loadSettings } from "@/lib/storage/settings.js"
import { resolveMcpSettingsPath } from "@/lib/storage/mcp-settings.js"

export type DoctorStatus = "pass" | "warn" | "fail"

export interface DoctorCheckResult {
	name: string
	status: DoctorStatus
	detail: string
}

type DoctorCheck = () => DoctorCheckResult | Promise<DoctorCheckResult>

/** The oldest Node major the CLI supports (install.sh MIN_NODE_VERSION, tsup target node22). */
const MIN_NODE_MAJOR = 22

/**
 * The cloud API the extension talks to, with the precedence of
 * `getTumbleCodeApiUrl` in packages/cloud/src/config.ts (the CLI sets no runtime
 * override, so the environment variable or the production URL applies). The
 * CLI does not depend on @tumble-code/cloud, whose entry point loads VS Code.
 */
const PRODUCTION_CLOUD_API_URL = "https://app.tumblecode.dev"

const CLOUD_TIMEOUT_MS = 3000
const RIPGREP_TIMEOUT_MS = 5000

/** The message, plus the cause undici hides behind "fetch failed" (ENOTFOUND, ECONNREFUSED). */
const errorText = (error: unknown): string => {
	if (!(error instanceof Error)) {
		return String(error)
	}

	const cause = error.cause

	if (cause instanceof Error) {
		const code = (cause as NodeJS.ErrnoException).code
		return `${error.message}: ${code ?? cause.message}`
	}

	return error.message
}

export function checkNodeVersion(version: string = process.versions.node): DoctorCheckResult {
	const major = Number.parseInt(version, 10)

	return major >= MIN_NODE_MAJOR
		? { name: "Node.js", status: "pass", detail: `v${version}` }
		: {
				name: "Node.js",
				status: "fail",
				detail: `v${version} is too old; Node.js ${MIN_NODE_MAJOR} or newer is required`,
			}
}

export function checkExtensionBundle(extensionPath: string): DoctorCheckResult {
	const bundle = path.join(extensionPath, "extension.js")

	return fs.existsSync(bundle)
		? { name: "Extension bundle", status: "pass", detail: bundle }
		: {
				name: "Extension bundle",
				status: "fail",
				detail: `${bundle} not found; reinstall the CLI or pass --extension <dir>`,
			}
}

/**
 * Where the extension looks for ripgrep from the CLI (its `appRoot` is the CLI
 * package root): the release launcher's ROO_RIPGREP_PATH first, then the
 * @vscode/ripgrep layouts of src/services/ripgrep `ripgrepCandidatePaths` that
 * can exist under a node_modules directory.
 */
export function ripgrepCandidates(cliRoot: string, override?: string): string[] {
	const binName = process.platform === "win32" ? "rg.exe" : "rg"
	const platformPackage = `@vscode/ripgrep-${process.platform}-${process.arch}`

	return [
		...(override && path.isAbsolute(override) ? [override] : []),
		path.join(cliRoot, "node_modules", "@vscode", "ripgrep", "bin", binName),
		path.join(cliRoot, "node_modules", platformPackage, "bin", binName),
	]
}

export async function checkRipgrep({
	cliRoot,
	override = readCliRuntimeEnv(process.env).ripgrepPath,
	runVersion = async (binary) =>
		(await execa(binary, ["--version"], { timeout: RIPGREP_TIMEOUT_MS, stdin: "ignore" })).stdout,
}: {
	cliRoot: string
	override?: string
	runVersion?: (binary: string) => Promise<string>
}): Promise<DoctorCheckResult> {
	const candidates = ripgrepCandidates(cliRoot, override)
	const binary = candidates.find((candidate) => fs.existsSync(candidate))

	if (!binary) {
		return {
			name: "ripgrep",
			status: "fail",
			detail: `not found (looked in ${candidates.join(", ")}); file search and code search will not work`,
		}
	}

	try {
		const version = (await runVersion(binary)).split("\n", 1)[0]?.trim()
		return { name: "ripgrep", status: "pass", detail: `${version || "runs"} (${binary})` }
	} catch (error) {
		return { name: "ripgrep", status: "fail", detail: `${binary} does not run: ${errorText(error)}` }
	}
}

export function checkMcpConfig(file: string): DoctorCheckResult {
	if (!fs.existsSync(file)) {
		return { name: "MCP config", status: "pass", detail: `no global MCP servers (${file} does not exist)` }
	}

	let parsed: unknown

	try {
		parsed = JSON.parse(fs.readFileSync(file, "utf8"))
	} catch (error) {
		return { name: "MCP config", status: "fail", detail: `${file} is not valid JSON: ${errorText(error)}` }
	}

	const servers = isRecord(parsed) ? parsed.mcpServers : undefined

	if (servers !== undefined && (!isRecord(servers) || Array.isArray(servers))) {
		return { name: "MCP config", status: "fail", detail: `${file}: "mcpServers" must be an object of servers` }
	}

	const count = servers ? Object.keys(servers).length : 0
	return { name: "MCP config", status: "pass", detail: `${count} ${count === 1 ? "server" : "servers"} in ${file}` }
}

export async function checkCloudReachable({
	url = process.env.ROO_CODE_API_URL || PRODUCTION_CLOUD_API_URL,
	fetchImpl = fetch,
	timeoutMs = CLOUD_TIMEOUT_MS,
}: {
	url?: string
	fetchImpl?: typeof fetch
	timeoutMs?: number
} = {}): Promise<DoctorCheckResult> {
	const started = Date.now()

	try {
		// Any HTTP answer proves the server is reachable; the status is only
		// reported. `redirect: "manual"` keeps a login redirect from counting
		// as a second request.
		const response = await fetchImpl(url, {
			method: "GET",
			redirect: "manual",
			signal: AbortSignal.timeout(timeoutMs),
		})
		return {
			name: "Cloud",
			status: "pass",
			detail: `${url} reachable (HTTP ${response.status}, ${Date.now() - started} ms)`,
		}
	} catch (error) {
		const reason =
			error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
				? `no answer within ${timeoutMs} ms`
				: errorText(error)

		return {
			name: "Cloud",
			status: "warn",
			detail: `${url} unreachable (${reason}); sessions still run, sharing and remote control are offline`,
		}
	}
}

export function formatDoctorReport(results: DoctorCheckResult[]): string {
	const width = Math.max(...results.map((result) => result.name.length), 0)
	const lines = results.map((result) => `[${result.status}] ${result.name.padEnd(width)}  ${result.detail}`)
	const failed = results.filter((result) => result.status === "fail").length
	const warnings = results.filter((result) => result.status === "warn").length
	const summary =
		failed === 0 && warnings === 0
			? "All checks passed."
			: `${failed} failed, ${warnings} ${warnings === 1 ? "warning" : "warnings"}.`

	return `${lines.join("\n")}\n\n${summary}\n`
}

/** Run the checks in order, print the report, and return the exit code. */
export async function runDoctor({
	checks,
	write = (text) => process.stdout.write(text),
}: {
	checks: DoctorCheck[]
	write?: (text: string) => void
}): Promise<number> {
	const results: DoctorCheckResult[] = []

	for (const [index, check] of checks.entries()) {
		try {
			results.push(await check())
		} catch (error) {
			results.push({ name: `check ${index + 1}`, status: "fail", detail: `crashed: ${errorText(error)}` })
		}
	}

	write(formatDoctorReport(results))
	return results.some((result) => result.status === "fail") ? 1 : 0
}

export interface DoctorOptions {
	extension?: string
}

/** `tumble doctor`: the real checks, in the order a session depends on them. */
export async function doctor(options: DoctorOptions = {}): Promise<number> {
	const dirname = path.dirname(fileURLToPath(import.meta.url))
	const extensionPath = path.resolve(options.extension || getDefaultExtensionPath(dirname))

	return runDoctor({
		checks: [
			() => checkNodeVersion(),
			() => checkExtensionBundle(extensionPath),
			() => checkRipgrep({ cliRoot: getCliPackageRoot(dirname) }),
			async () => {
				try {
					return checkMcpConfig(resolveMcpSettingsPath((await loadSettings()).mcpSettingsPath))
				} catch (error) {
					return { name: "MCP config", status: "fail", detail: `cli-settings.json: ${errorText(error)}` }
				}
			},
			() => checkCloudReachable(),
		],
	})
}
