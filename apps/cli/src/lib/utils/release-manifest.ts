import fs from "fs"
import path from "path"

export interface PackageManifest {
	name: string
	version: string
	type?: string
	dependencies?: Record<string, string>
}

/**
 * Dependencies tsup bundles into dist (its `noExternal`), so the release must
 * not install them again. ink, react and zustand are here because the release
 * installs its manifest with `npm install` and no lockfile: left external they
 * floated to whatever the registry had that day, and the installed CLI then
 * rendered with other versions than development (React 19.3.0 against 19.2.3).
 * Bundling them also bundles everything they import (react-reconciler,
 * scheduler, yoga-layout, string-width, wrap-ansi, ...) at the lockfile versions.
 */
export const BUNDLED_DEPENDENCIES = [
	"@roo-code/core",
	"@roo-code/types",
	"@roo-code/vscode-shim",
	"ink",
	"react",
	"zustand",
]

const RELEASE_EXCLUDED_DEPENDENCIES = new Set([
	...BUNDLED_DEPENDENCIES,
	// The release ships the ripgrep binary itself (apps/cli/scripts/build.sh).
	"@vscode/ripgrep",
])

/**
 * The manifest the release installs with `npm install --production`: the
 * dependencies that stay external, each pinned to the exact version
 * `resolveVersion` reports, so the release installs what development ran.
 */
export function createReleaseManifest(
	source: PackageManifest,
	version: string,
	resolveVersion: (name: string) => string,
): PackageManifest {
	const dependencies = Object.fromEntries(
		Object.keys(source.dependencies ?? {})
			.filter((name) => !RELEASE_EXCLUDED_DEPENDENCIES.has(name))
			.map((name) => [name, resolveVersion(name)]),
	)

	return {
		name: source.name,
		version,
		type: source.type,
		dependencies,
	}
}

/**
 * Reads the version pnpm installed for a direct dependency of the package in
 * `packageDir`, which is the version pnpm-lock.yaml pins after a frozen install.
 */
export function readInstalledVersion(packageDir: string): (name: string) => string {
	return (name) => {
		const manifest = path.join(packageDir, "node_modules", name, "package.json")
		return JSON.parse(fs.readFileSync(manifest, "utf8")).version
	}
}
