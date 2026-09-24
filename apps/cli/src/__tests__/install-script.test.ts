import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"

const INSTALL_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../install.sh")
const FORK = "krzychdre/Tumble-Code"

/**
 * Runs install.sh with a fake `curl` first on PATH. The fake records every
 * URL it is asked for, answers the GitHub releases API with one CLI release
 * and fails every download, so the installer stops right after it has built
 * the download URL and never touches the real network or the real HOME.
 */
function runInstaller(env: Record<string, string> = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tumble-install-"))
	const binDir = path.join(dir, "bin")
	const log = path.join(dir, "curl.log")
	fs.mkdirSync(binDir)
	fs.writeFileSync(
		path.join(binDir, "curl"),
		[
			"#!/bin/sh",
			`for arg in "$@"; do case "$arg" in http*) echo "$arg" >> "${log}" ;; esac; done`,
			'case "$*" in',
			`  *api.github.com*) echo '[{"tag_name":"cli-v1.2.3"},{"tag_name":"nightly-v0.0.1"}]' ;;`,
			"  *) exit 22 ;;",
			"esac",
		].join("\n"),
		{ mode: 0o755 },
	)

	const result = spawnSync("sh", [INSTALL_SCRIPT], {
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
			HOME: dir,
			ROO_INSTALL_DIR: path.join(dir, "install"),
			ROO_BIN_DIR: path.join(dir, "local-bin"),
			ROO_VERSION: "",
			ROO_LOCAL_TARBALL: "",
			...env,
		},
	})
	const urls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []
	fs.rmSync(dir, { recursive: true, force: true })
	return { ...result, urls }
}

// DEF-C29: the installer fetched releases from upstream RooCodeInc/Roo-Code,
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
