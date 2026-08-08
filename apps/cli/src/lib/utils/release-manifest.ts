export interface PackageManifest {
	name: string
	version: string
	type?: string
	dependencies?: Record<string, string>
}

const RELEASE_EXCLUDED_DEPENDENCIES = new Set([
	"@roo-code/core",
	"@roo-code/types",
	"@roo-code/vscode-shim",
	"@vscode/ripgrep",
])

export function createReleaseManifest(source: PackageManifest, version: string): PackageManifest {
	const dependencies = Object.fromEntries(
		Object.entries(source.dependencies ?? {}).filter(([name]) => !RELEASE_EXCLUDED_DEPENDENCIES.has(name)),
	)

	return {
		name: source.name,
		version,
		type: source.type,
		dependencies,
	}
}
