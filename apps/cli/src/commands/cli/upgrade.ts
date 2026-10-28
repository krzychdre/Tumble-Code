import { spawn } from "child_process"

import { VERSION } from "@/lib/utils/version.js"

// The extension and the CLI ship in one release under one version; nightly
// builds are pre-releases, which GitHub never reports as latest.
const LATEST_RELEASE_URL = "https://api.github.com/repos/krzychdre/tumble-code/releases/latest"

/** A release version as GitHub reports it, without the leading "v". */
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/**
 * The installer of exactly `version`: the install.sh of that release's tag,
 * not of the moving main branch, downloaded whole before it runs (a pipe into
 * sh runs a download cut short), and it checks the tarball against the
 * release's .sha256 before unpacking it.
 */
export function installScriptCommand(version: string): string {
	if (!RELEASE_VERSION.test(version)) {
		throw new Error(`Refusing to install an unexpected version: ${JSON.stringify(version)}`)
	}
	const url = `https://raw.githubusercontent.com/krzychdre/tumble-code/v${version}/apps/cli/install.sh`
	return `script=$(mktemp) && trap 'rm -f "$script"' EXIT && curl -fsSL ${url} -o "$script" && sh "$script"`
}

export interface UpgradeOptions {
	currentVersion?: string
	fetchImpl?: typeof fetch
	runInstaller?: () => Promise<void>
}

function parseVersion(version: string): number[] {
	const cleaned = version.trim().replace(/^v/, "")
	const core = cleaned.split("+", 1)[0]?.split("-", 1)[0]

	if (!core) {
		throw new Error(`Invalid version: ${version}`)
	}

	const parts = core.split(".")
	if (parts.length === 0) {
		throw new Error(`Invalid version: ${version}`)
	}

	return parts.map((part) => {
		if (!/^\d+$/.test(part)) {
			throw new Error(`Invalid version: ${version}`)
		}

		return Number.parseInt(part, 10)
	})
}

/**
 * Returns:
 * - 1 when `a > b`
 * - 0 when `a === b`
 * - -1 when `a < b`
 */
export function compareVersions(a: string, b: string): number {
	const aParts = parseVersion(a)
	const bParts = parseVersion(b)
	const maxLength = Math.max(aParts.length, bParts.length)

	for (let i = 0; i < maxLength; i++) {
		const aPart = aParts[i] ?? 0
		const bPart = bParts[i] ?? 0

		if (aPart > bPart) {
			return 1
		}

		if (aPart < bPart) {
			return -1
		}
	}

	return 0
}

export async function getLatestCliVersion(fetchImpl: typeof fetch = fetch): Promise<string> {
	const response = await fetchImpl(LATEST_RELEASE_URL, {
		headers: {
			Accept: "application/vnd.github+json",
			"User-Agent": "roo-cli",
		},
	})

	if (!response.ok) {
		throw new Error(`Failed to check latest version (HTTP ${response.status})`)
	}

	const release = (await response.json()) as { tag_name: string }
	return release.tag_name.replace(/^v/, "")
}

export function runUpgradeInstaller(version: string, spawnImpl: typeof spawn = spawn): Promise<void> {
	return new Promise((resolve, reject) => {
		const command = installScriptCommand(version)
		const env = { ...process.env, ROO_VERSION: version }
		const child = spawnImpl("sh", ["-c", command], { stdio: "inherit", env })

		child.once("error", (error) => {
			reject(error)
		})

		child.once("close", (code, signal) => {
			if (code === 0) {
				resolve()
				return
			}

			const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`
			reject(new Error(`Upgrade installer failed (${reason}).`))
		})
	})
}

export async function upgrade(options: UpgradeOptions = {}): Promise<void> {
	const currentVersion = options.currentVersion ?? VERSION
	const fetchImpl = options.fetchImpl ?? fetch
	const runInstaller = options.runInstaller

	console.log(`Current version: ${currentVersion}`)

	const latestVersion = await getLatestCliVersion(fetchImpl)
	console.log(`Latest version: ${latestVersion}`)

	if (compareVersions(latestVersion, currentVersion) <= 0) {
		console.log("Tumble CLI is already up to date.")
		return
	}

	console.log(`Upgrading Tumble CLI from ${currentVersion} to ${latestVersion}...`)
	if (runInstaller) {
		await runInstaller()
	} else {
		await runUpgradeInstaller(latestVersion)
	}
	console.log("✓ Upgrade completed.")
}
