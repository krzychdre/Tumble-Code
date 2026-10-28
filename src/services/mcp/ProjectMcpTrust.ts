import { createHash } from "crypto"

/**
 * The consent gate for the servers of a project's `.roo/mcp.json`.
 *
 * A project file arrives with the repository: cloning someone else's code and
 * opening it must not run a command that code chose. So a project server is
 * started only once the user has agreed to its launch settings (the command,
 * arguments, working directory and environment of a stdio server; the URL and
 * headers of a remote one). The agreement is remembered per workspace and per
 * launch settings: an edit that changes what would run, by a teammate's commit
 * or by the agent itself, asks again. Edits that change nothing that runs
 * (alwaysAllow, disabledTools, timeout, disabled) do not.
 *
 * A workspace the editor itself does not trust (VS Code's Restricted Mode)
 * starts no project server and asks nothing.
 */

/** Where the agreed fingerprints are kept (the extension's global state). */
export interface TrustStore {
	get<T>(key: string): T | undefined
	update(key: string, value: unknown): Thenable<void>
}

/** One server the user is asked about. */
export interface ProjectServerLaunch {
	name: string
	/** What would run, in one line: `command arg1 arg2` or the URL. */
	launch: string
}

export interface ProjectMcpTrustDeps {
	store: () => TrustStore | undefined
	/** False in a workspace the editor runs in Restricted Mode. */
	isWorkspaceTrusted: () => boolean
	/** Asks the user whether to start these servers from `configPath`; true to start them. */
	confirm: (configPath: string, servers: ProjectServerLaunch[]) => Promise<boolean>
}

export const TRUSTED_PROJECT_MCP_KEY = "trustedProjectMcpServers"

/** The newest fingerprints kept; older agreements are asked again. */
const MAX_TRUSTED = 500

/** The settings of a server entry that decide what runs or where it connects. */
const LAUNCH_KEYS = ["type", "command", "args", "cwd", "env", "url", "headers"] as const

type RawServer = Record<string, unknown>

function isRecord(value: unknown): value is RawServer {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** JSON with object keys sorted, so the same settings always hash the same. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(canonical).join(",")}]`
	}
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.filter((key) => value[key] !== undefined)
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(",")}}`
	}
	return JSON.stringify(value) ?? "null"
}

/** The fingerprint of one server of one project file: its file, its name and its launch settings. */
export function projectServerFingerprint(configPath: string, name: string, config: RawServer): string {
	const launch: RawServer = {}
	for (const key of LAUNCH_KEYS) {
		launch[key] = config[key]
	}
	return createHash("sha256").update(canonical({ configPath, name, launch })).digest("hex")
}

/** What a server would run, for the question. */
export function describeLaunch(config: RawServer): string {
	if (typeof config.command === "string") {
		const args = Array.isArray(config.args) ? config.args.map(String) : []
		return [config.command, ...args].join(" ")
	}
	return typeof config.url === "string" ? config.url : JSON.stringify(config)
}

export class ProjectMcpTrust {
	/** One question at a time: the start-up read and a file change can arrive together. */
	private queue: Promise<unknown> = Promise.resolve()

	constructor(private readonly deps: ProjectMcpTrustDeps) {}

	/**
	 * The servers of the project file at `configPath` that may start: every
	 * disabled one (nothing runs), every one already agreed to, and the rest
	 * only if the user agrees now. The others are left out.
	 */
	filter(configPath: string, servers: Record<string, unknown>): Promise<Record<string, unknown>> {
		const run = this.queue.then(() => this.decide(configPath, servers))
		this.queue = run.catch(() => undefined)
		return run
	}

	private async decide(configPath: string, servers: Record<string, unknown>): Promise<Record<string, unknown>> {
		const trusted = new Set(this.trustedFingerprints())
		const allowed: Record<string, unknown> = {}
		const pending: { name: string; config: RawServer; fingerprint: string }[] = []

		for (const [name, config] of Object.entries(servers)) {
			if (!isRecord(config)) {
				continue
			}
			const fingerprint = projectServerFingerprint(configPath, name, config)
			if (config.disabled === true || trusted.has(fingerprint)) {
				allowed[name] = config
			} else {
				pending.push({ name, config, fingerprint })
			}
		}

		if (pending.length === 0 || !this.deps.isWorkspaceTrusted()) {
			return allowed
		}

		const agreed = await this.deps.confirm(
			configPath,
			pending.map(({ name, config }) => ({ name, launch: describeLaunch(config) })),
		)
		if (!agreed) {
			return allowed
		}

		await this.remember(pending.map(({ fingerprint }) => fingerprint))
		for (const { name, config } of pending) {
			allowed[name] = config
		}
		return allowed
	}

	private trustedFingerprints(): string[] {
		const stored = this.deps.store()?.get<unknown>(TRUSTED_PROJECT_MCP_KEY)
		return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === "string") : []
	}

	private async remember(fingerprints: string[]): Promise<void> {
		const store = this.deps.store()
		if (!store) {
			return
		}
		const next = [...this.trustedFingerprints().filter((entry) => !fingerprints.includes(entry)), ...fingerprints]
		await store.update(TRUSTED_PROJECT_MCP_KEY, next.slice(-MAX_TRUSTED))
	}
}
