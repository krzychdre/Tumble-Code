import fs from "fs"
import path from "path"

export const CLI_ROOT = path.resolve(__dirname, "../../../..")

const LOCKFILE = path.resolve(CLI_ROOT, "../../pnpm-lock.yaml")

/**
 * The lines of one block of pnpm-lock.yaml: the header line `header` and every
 * following line indented deeper than it.
 */
function lockfileBlock(lines: string[], header: string): string[] {
	const start = lines.indexOf(header)

	if (start === -1) {
		throw new Error(`pnpm-lock.yaml has no line ${JSON.stringify(header)}`)
	}

	const indent = header.length - header.trimStart().length
	const block: string[] = []

	for (const line of lines.slice(start + 1)) {
		if (line.trim() !== "" && line.length - line.trimStart().length <= indent) {
			break
		}

		block.push(line)
	}

	return block
}

/** `6.6.0(@types/react@19.3.0)(react@19.2.3)` -> `6.6.0` */
const bareVersion = (version: string) => version.replace(/\(.*$/, "")

/**
 * The versions pnpm-lock.yaml pins for the CLI's direct dependencies and for
 * the packages ink renders with, read from the lockfile itself rather than
 * from node_modules, so a stale install cannot agree with itself.
 */
export function lockedVersions(): Record<string, string> {
	const lines = fs.readFileSync(LOCKFILE, "utf8").split("\n")
	const versions: Record<string, string> = {}

	// importers: apps/cli: dependencies: <name>: specifier / version
	const importer = lockfileBlock(lines, "  apps/cli:")
	const dependencies = lockfileBlock(importer, "    dependencies:")

	for (let i = 0; i < dependencies.length; i++) {
		const name = dependencies[i]!.match(/^ {6}'?([^':]+)'?:$/)?.[1]
		const version = dependencies[i + 2]?.match(/^ {8}version: (.+)$/)?.[1]

		if (name && version) {
			versions[name] = version
		}
	}

	// snapshots: the block of the resolved ink names its own dependencies.
	const snapshotDependency = (snapshot: string, name: string) => {
		const line = lockfileBlock(lines, `  ${snapshot}:`).find((entry) => entry.startsWith(`      ${name}: `))

		if (!line) {
			throw new Error(`pnpm-lock.yaml snapshot ${snapshot} has no dependency ${name}`)
		}

		return line.slice(`      ${name}: `.length).replace(/^'|'$/g, "")
	}

	const ink = `ink@${versions.ink}`
	versions["react-reconciler"] = snapshotDependency(ink, "react-reconciler")
	versions["yoga-layout"] = snapshotDependency(ink, "yoga-layout")
	versions.scheduler = snapshotDependency(`react-reconciler@${versions["react-reconciler"]}`, "scheduler")

	return Object.fromEntries(Object.entries(versions).map(([name, version]) => [name, bareVersion(version)]))
}
