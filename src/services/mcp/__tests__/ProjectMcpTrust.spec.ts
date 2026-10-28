// cd src && npx vitest run services/mcp/__tests__/ProjectMcpTrust.spec.ts

import {
	ProjectMcpTrust,
	TRUSTED_PROJECT_MCP_KEY,
	describeLaunch,
	projectServerFingerprint,
	type ProjectServerLaunch,
} from "../ProjectMcpTrust"

function memoryStore() {
	const values = new Map<string, unknown>()
	return {
		values,
		get: <T>(key: string) => values.get(key) as T | undefined,
		update: async (key: string, value: unknown) => void values.set(key, value),
	}
}

const file = "/repo/.roo/mcp.json"

describe("ProjectMcpTrust", () => {
	let store: ReturnType<typeof memoryStore>
	let asked: ProjectServerLaunch[][]
	let answer: boolean
	let workspaceTrusted: boolean
	let trust: ProjectMcpTrust

	beforeEach(() => {
		store = memoryStore()
		asked = []
		answer = true
		workspaceTrusted = true
		trust = new ProjectMcpTrust({
			store: () => store,
			isWorkspaceTrusted: () => workspaceTrusted,
			confirm: async (_path, servers) => {
				asked.push(servers)
				return answer
			},
		})
	})

	it("withholds the servers the user refuses and keeps the disabled ones, which run nothing", async () => {
		answer = false
		const servers = { run: { command: "sh", args: ["-c", "id"] }, off: { command: "sh", disabled: true } }

		expect(await trust.filter(file, servers)).toEqual({ off: servers.off })
		expect(asked).toEqual([[{ name: "run", launch: "sh -c id" }]])
		expect(store.values.has(TRUSTED_PROJECT_MCP_KEY)).toBe(false)
	})

	it("asks once for all new servers and remembers the yes", async () => {
		const servers = { a: { command: "a" }, b: { type: "sse", url: "https://x.example/sse" } }

		expect(await trust.filter(file, servers)).toEqual(servers)
		expect(await trust.filter(file, servers)).toEqual(servers)
		expect(asked).toEqual([
			[
				{ name: "a", launch: "a" },
				{ name: "b", launch: "https://x.example/sse" },
			],
		])
	})

	it("never asks and starts nothing new in a workspace the editor does not trust", async () => {
		workspaceTrusted = false
		expect(await trust.filter(file, { a: { command: "a" } })).toEqual({})
		expect(asked).toEqual([])
	})

	it("asks one question at a time when two reads arrive together", async () => {
		const servers = { a: { command: "a" } }
		const [first, second] = await Promise.all([trust.filter(file, servers), trust.filter(file, servers)])
		expect(first).toEqual(servers)
		expect(second).toEqual(servers)
		expect(asked).toHaveLength(1)
	})

	it("fingerprints what runs: file, name and launch settings, not tool settings or key order", () => {
		const base = { command: "node", args: ["s.js"], env: { A: "1", B: "2" } }
		const fp = projectServerFingerprint(file, "s", base)

		expect(projectServerFingerprint(file, "s", { env: { B: "2", A: "1" }, args: ["s.js"], command: "node" })).toBe(
			fp,
		)
		expect(projectServerFingerprint(file, "s", { ...base, alwaysAllow: ["x"], timeout: 9, disabled: false })).toBe(
			fp,
		)
		expect(projectServerFingerprint(file, "s", { ...base, args: ["t.js"] })).not.toBe(fp)
		expect(projectServerFingerprint(file, "s", { ...base, env: { A: "1", B: "3" } })).not.toBe(fp)
		expect(projectServerFingerprint(file, "s", { ...base, cwd: "/elsewhere" })).not.toBe(fp)
		expect(projectServerFingerprint(file, "t", base)).not.toBe(fp)
		expect(projectServerFingerprint("/other/.roo/mcp.json", "s", base)).not.toBe(fp)
	})

	it("describes a server by its command line or its URL", () => {
		expect(describeLaunch({ command: "npx", args: ["-y", "pkg"] })).toBe("npx -y pkg")
		expect(describeLaunch({ url: "https://x.example/mcp" })).toBe("https://x.example/mcp")
	})
})
