import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"

const INSTALL_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../install.sh")
const FORK = "krzychdre/Tumble-Code"

/**
 * Builds a real CLI tarball - package.json, bin/tumble and the bundled
 * ripgrep binary under a release-directory prefix, exactly like the release
 * build does - that the fake curl serves for download requests, so tests can
 * walk the installer all the way into the dependency-install step.
 */
function createTarball(dir: string): string {
	const releaseName = "tumble-cli-release"
	const root = path.join(dir, releaseName)
	fs.mkdirSync(path.join(root, "bin"), { recursive: true })
	fs.mkdirSync(path.join(root, "node_modules", "@vscode", "ripgrep", "bin"), { recursive: true })
	fs.writeFileSync(
		path.join(root, "package.json"),
		JSON.stringify({ name: "tumble-cli", version: "1.2.3", dependencies: { "left-pad": "1.3.0" } }),
	)
	fs.writeFileSync(path.join(root, "bin", "tumble"), "#!/bin/sh\necho 1.2.3\n")
	fs.writeFileSync(path.join(root, "node_modules", "@vscode", "ripgrep", "bin", "rg"), "#!/bin/sh\n")
	const tarball = path.join(dir, "tumble-cli-fake.tar.gz")
	const result = spawnSync("tar", ["-czf", tarball, "-C", dir, releaseName])
	if (result.status !== 0) {
		throw new Error(`tar failed: ${result.stderr?.toString()}`)
	}
	return tarball
}

/**
 * Runs install.sh with fake `curl` and `npm` first on PATH. The fake curl
 * records every URL it is asked for, answers the GitHub releases API with one
 * CLI release and, unless `serveTarball` is set, fails every download - so the
 * default runs never touch the real network or the real HOME. The fake npm
 * records every invocation in a log and is steered with TUMBLE_NPM_* env
 * variables: which subcommand fails, whether the cache-only (--offline)
 * install succeeds, or whether an install hangs.
 */
function runInstaller(
	env: Record<string, string> = {},
	opts: { serveTarball?: boolean; previousInstall?: boolean } = {},
) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tumble-install-"))
	const binDir = path.join(dir, "bin")
	const log = path.join(dir, "curl.log")
	const npmLog = path.join(dir, "npm.log")
	const installDir = path.join(dir, "install")
	fs.mkdirSync(binDir)

	if (opts.previousInstall) {
		// An old installation at the target that must survive a failed run.
		fs.mkdirSync(installDir, { recursive: true })
		fs.writeFileSync(path.join(installDir, "previous.txt"), "keep me\n")
	}

	fs.writeFileSync(
		path.join(binDir, "curl"),
		[
			"#!/bin/sh",
			`for arg in "$@"; do case "$arg" in http*) echo "$arg" >> "${log}" ;; esac; done`,
			'case "$*" in',
			`  *api.github.com*) echo '[{"tag_name":"cli-v1.2.3"},{"tag_name":"nightly-v0.0.1"}]' ;;`,
			"  *)",
			'    if [ -n "$TUMBLE_TARBALL" ]; then',
			'      prev=""',
			'      for arg in "$@"; do',
			'        if [ "$prev" = "-o" ]; then cp "$TUMBLE_TARBALL" "$arg"; fi',
			'        prev="$arg"',
			"      done",
			"      exit 0",
			"    fi",
			"    exit 22 ;;",
			"esac",
		].join("\n"),
		{ mode: 0o755 },
	)

	fs.writeFileSync(
		path.join(binDir, "npm"),
		[
			"#!/bin/sh",
			`echo "npm $*" >> "${npmLog}"`,
			'case "$1" in',
			"  ping)",
			'    if [ -n "$TUMBLE_NPM_PING_FAILS" ]; then echo "npm error request to https://registry.npmjs.org/-/ping failed" >&2; exit 1; fi',
			"    exit 0 ;;",
			"  install)",
			'    case "$*" in',
			"      *--offline*)",
			'        if [ -n "$TUMBLE_NPM_OFFLINE_SUCCEEDS" ]; then exit 0; fi',
			'        echo "npm error No matching version found for left-pad" >&2',
			"        exit 1 ;;",
			"    esac",
			'    if [ -n "$TUMBLE_NPM_INSTALL_HANG_SECS" ]; then sleep "$TUMBLE_NPM_INSTALL_HANG_SECS"; fi',
			'    if [ -n "$TUMBLE_NPM_INSTALL_FAILS" ]; then echo "npm error E404 not found" >&2; exit 1; fi',
			"    exit 0 ;;",
			"esac",
			"exit 0",
		].join("\n"),
		{ mode: 0o755 },
	)

	const runEnv = opts.serveTarball ? { ...env, TUMBLE_TARBALL: createTarball(dir) } : env

	const result = spawnSync("sh", [INSTALL_SCRIPT], {
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
			HOME: dir,
			ROO_INSTALL_DIR: installDir,
			ROO_BIN_DIR: path.join(dir, "local-bin"),
			ROO_VERSION: "",
			ROO_LOCAL_TARBALL: "",
			TUMBLE_TARBALL: "",
			TUMBLE_NPM_PING_FAILS: "",
			TUMBLE_NPM_OFFLINE_SUCCEEDS: "",
			TUMBLE_NPM_INSTALL_HANG_SECS: "",
			TUMBLE_NPM_INSTALL_FAILS: "",
			...runEnv,
		},
	})
	const urls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []
	const npmLogLines = fs.existsSync(npmLog) ? fs.readFileSync(npmLog, "utf8").trim().split("\n").filter(Boolean) : []
	// Snapshot the target directory before the temp dir that contains it is removed.
	const readInInstall = (name: string): string | null => {
		try {
			return fs.readFileSync(path.join(installDir, name), "utf8")
		} catch {
			return null
		}
	}
	const install = {
		exists: fs.existsSync(installDir),
		entries: fs.existsSync(installDir) ? fs.readdirSync(installDir).sort() : null,
		packageJson: readInInstall("package.json"),
		previous: readInInstall("previous.txt"),
		binTumble: fs.existsSync(path.join(installDir, "bin", "tumble")),
	}
	fs.rmSync(dir, { recursive: true, force: true })
	return { ...result, urls, npmLogLines, install }
}

// DEF-C29: the installer fetched releases from the upstream Roo repository,
// while the fork's release notes (cli-release.yml) tell users to run this
// script: they got upstream's CLI, or no CLI at all.
describe.skipIf(process.platform === "win32")("install.sh", () => {
	it("looks up the latest CLI release in the fork", () => {
		const { urls } = runInstaller()

		expect(urls[0]).toBe(`https://api.github.com/repos/${FORK}/releases`)
	})

	it("downloads the CLI tarball from the fork's release", () => {
		const { urls, status } = runInstaller()

		expect(status).not.toBe(0) // The fake download fails.
		expect(urls[1]).toMatch(
			new RegExp(
				`^https://github\\.com/${FORK}/releases/download/cli-v1\\.2\\.3/tumble-cli-[a-z]+-[a-z0-9]+\\.tar\\.gz$`,
			),
		)
	})

	it("downloads a pinned version from the fork", () => {
		const { urls } = runInstaller({ ROO_VERSION: "9.8.7" })

		expect(urls).toHaveLength(1)
		expect(urls[0]).toMatch(new RegExp(`^https://github\\.com/${FORK}/releases/download/cli-v9\\.8\\.7/`))
	})
})

// Without network access the installer used to sit inside `npm install` for
// minutes with npm's output thrown away, and it had already deleted the
// previous installation - so a dead Wi-Fi moment could leave the CLI broken.
describe.skipIf(process.platform === "win32")("install.sh network hardening", () => {
	it("installs the staged release when the registry answers", () => {
		const { status, npmLogLines, stdout, install } = runInstaller({}, { serveTarball: true, previousInstall: true })

		expect(status).toBe(0)
		// The staged tarball replaced the previous installation on success.
		expect(install.previous).toBeNull()
		expect(install.packageJson).toContain("tumble-cli")
		expect(install.binTumble).toBe(true)
		// Exactly one bounded online install attempt: no --production, no offline mode.
		expect(npmLogLines.filter((line) => line.startsWith("npm install"))).toEqual([
			"npm install --omit=dev --no-audit --no-fund --loglevel=warn --prefer-offline",
		])
		expect(stdout).toContain("Installing dependencies...")
	})

	it("keeps the previous installation when the machine is truly offline", () => {
		const { status, npmLogLines, stderr, install } = runInstaller(
			{ TUMBLE_NPM_PING_FAILS: "1", TUMBLE_NPM_INSTALL_FAILS: "1" },
			{ serveTarball: true, previousInstall: true },
		)

		expect(status).not.toBe(0)
		expect(stderr).toContain("Failed to install dependencies")
		// Cache-only first, then bounded registry attempts; nothing unbounded.
		expect(npmLogLines.filter((line) => line.startsWith("npm install"))).toEqual([
			"npm install --omit=dev --no-audit --no-fund --loglevel=warn --offline",
			"npm install --omit=dev --no-audit --no-fund --loglevel=warn --prefer-offline",
			"npm install --omit=dev --no-audit --no-fund --loglevel=warn --prefer-offline --legacy-peer-deps",
		])
		expect(install.previous).toBe("keep me\n")
	})

	it("still installs when the registry ping was a false alarm", () => {
		const { status, npmLogLines, stdout, install } = runInstaller(
			{ TUMBLE_NPM_PING_FAILS: "1" },
			{ serveTarball: true },
		)

		expect(status).toBe(0)
		// The cache-only attempt fails, then the bounded registry attempts run.
		expect(npmLogLines.filter((line) => line.startsWith("npm install"))).toEqual([
			"npm install --omit=dev --no-audit --no-fund --loglevel=warn --offline",
			"npm install --omit=dev --no-audit --no-fund --loglevel=warn --prefer-offline",
		])
		expect(stdout).toContain("Installing dependencies...")
		expect(install.packageJson).toContain("tumble-cli")
	})

	it("installs from a warm npm cache when the registry is unreachable", () => {
		const { status, stdout, install } = runInstaller(
			{ TUMBLE_NPM_PING_FAILS: "1", TUMBLE_NPM_OFFLINE_SUCCEEDS: "1" },
			{ serveTarball: true },
		)

		expect(status).toBe(0)
		expect(stdout).toContain("npm cache")
		expect(install.packageJson).not.toBeNull()
	})

	it("kills npm and reports a timeout instead of hanging when it stalls", () => {
		const { status, npmLogLines, stderr, install } = runInstaller(
			{ ROO_NPM_TIMEOUT: "1", TUMBLE_NPM_INSTALL_HANG_SECS: "8" },
			{ serveTarball: true, previousInstall: true },
		)

		expect(status).not.toBe(0)
		expect(stderr).toContain("timed out after 1s")
		// A timeout is a network verdict: no --legacy-peer-deps retry follows it.
		expect(npmLogLines.join("\n")).toContain("--prefer-offline")
		expect(npmLogLines.join("\n")).not.toContain("--legacy-peer-deps")
		expect(install.previous).toBe("keep me\n")
	})

	it("retries a failed install with --legacy-peer-deps and keeps the machine clean", () => {
		const { status, npmLogLines, install } = runInstaller({ TUMBLE_NPM_INSTALL_FAILS: "1" }, { serveTarball: true })

		expect(status).not.toBe(0)
		const installs = npmLogLines.filter((line) => line.startsWith("npm install"))
		expect(installs).toHaveLength(2)
		expect(installs[1]).toContain("--legacy-peer-deps")
		// Nothing lands at the target when the dependencies could not be installed.
		expect(install.exists).toBe(false)
	})
})
