// cd src && npx vitest run core/prompts/__tests__/compact-profile-prompt.spec.ts
//
// The compact system prompt (compact profile, workstream A,
// ai_plans/2026-10-10_20-07_compact-a-prompt.md). It is written for a 4B model
// with a 40,960-token window, so its size is a budget, not a style choice:
//
//   - at most 4,000 characters without the user's own content (language,
//     global and mode instructions, the mode's role, rule files, AGENTS.md,
//     .rooignore) and without the memory index;
//   - the memory index in the compact line format, capped at 6,000 characters.
//
// The snapshots in __snapshots__/compact-profile/ are the full compact prompt
// of every built-in mode, with a memory index above the cap and with MCP,
// skills and deferred tools all switched on, so their absence is pinned too.
// Regenerate with `-u` only for a deliberate wording change, and state the
// KV-cache effect in the commit message (CONTRIBUTING.md).

vi.mock("os", () => {
	const os = {
		homedir: () => "/home/user",
		platform: () => "linux",
		arch: () => "x64",
		type: () => "Linux",
		release: () => "5.4.0",
		hostname: () => "test-host",
		tmpdir: () => "/tmp",
		endianness: () => "LE",
		loadavg: () => [0, 0, 0],
		totalmem: () => 8589934592,
		freemem: () => 4294967296,
		cpus: () => [],
		networkInterfaces: () => ({}),
		userInfo: () => ({ username: "test", uid: 1000, gid: 1000, shell: "/bin/bash", homedir: "/home/user" }),
	}
	return { default: os, ...os }
})

vi.mock("default-shell", () => ({ default: "/bin/zsh" }))
vi.mock("os-name", () => ({ default: () => "Linux" }))
vi.mock("../../../utils/shell", () => ({ getShell: () => "/bin/zsh" }))
// The memory paths are built with path.join: give them as on Linux on every
// platform, like the os stub above, so the pinned bytes match on a Windows runner.
vi.mock("path", async (importOriginal) => {
	const actual = await importOriginal<typeof import("path")>()
	return { ...actual.posix, default: actual.posix }
})

const { MEMORY_ROOT, MEMORY_INDEX_FIXTURE, memoryIndex } = vi.hoisted(() => {
	// 80 index lines of about 100 characters, about 78 in the compact line
	// format: about 6,200 characters, above the compact cap of 6,000.
	const lines: string[] = []
	for (let i = 1; i <= 80; i++) {
		const n = String(i).padStart(2, "0")
		lines.push(`- [Note ${n}](note_${n}.md) - a fixed memory entry that keeps the index above the compact cap`)
	}
	return {
		MEMORY_ROOT: "/mock/settings/path/memory/",
		MEMORY_INDEX_FIXTURE: `# Memory Index\n\n${lines.join("\n")}\n`,
		/** Whether the stubbed MEMORY.md exists; the budget test turns it off. */
		memoryIndex: { present: true },
	}
})

// Reads and mkdirs under the memory root are answered here; everything else
// goes to the real filesystem (the workspace /test/path does not exist, so
// there are no rule files and no AGENTS.md).
vi.mock("fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs/promises")>()
	const isMemoryPath = (p: unknown) => String(p).startsWith(MEMORY_ROOT)
	const readFile = (async (p: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
		if (isMemoryPath(p)) {
			if (String(p).endsWith("MEMORY.md") && memoryIndex.present) {
				return MEMORY_INDEX_FIXTURE
			}
			throw Object.assign(new Error(`ENOENT: ${String(p)}`), { code: "ENOENT" })
		}
		return (actual.readFile as (...args: unknown[]) => unknown)(p, ...rest)
	}) as typeof actual.readFile
	const mkdir = (async (p: Parameters<typeof actual.mkdir>[0], ...rest: unknown[]) => {
		if (isMemoryPath(p)) {
			return undefined
		}
		return (actual.mkdir as (...args: unknown[]) => unknown)(p, ...rest)
	}) as typeof actual.mkdir
	const mocked = { ...actual, readFile, mkdir }
	return { ...mocked, default: mocked }
})

vi.mock("../../../utils/globalContext", () => ({
	ensureSettingsDirectoryExists: vi.fn(async () => "/mock/settings/path/settings"),
}))

vi.mock("../../../services/code-index/manager", () => ({
	CodeIndexManager: {
		getInstance: vi.fn(() => ({ isFeatureEnabled: true, isFeatureConfigured: true, isInitialized: true })),
	},
}))

import type * as vscode from "vscode"

import type { ModeConfig } from "@tumble-code/types"

import type { McpHub } from "../../../services/mcp/McpHub"
import type { SkillsManager } from "../../../services/skills/SkillsManager"
import { modes } from "../../../shared/modes"
import { initMemoryPaths, resetMemoryPaths } from "../../memory/paths"
import { compactMemoryIndex } from "../../memory/memoryPrompt"
import { SYSTEM_PROMPT } from "../system"
import type { SystemPromptSettings } from "../types"

const CWD = "/test/path"
const SNAPSHOT_DIR = "./__snapshots__/compact-profile"
const BUDGET_CHARS = 4_000

const mockContext = {
	extensionPath: "/mock/extension/path",
	globalStoragePath: "/mock/storage/path",
	subscriptions: [],
	workspaceState: { get: () => undefined, update: () => Promise.resolve() },
	globalState: { get: () => undefined, update: () => Promise.resolve(), setKeysForSync: () => {} },
	extensionUri: { fsPath: "/mock/extension/path" },
	globalStorageUri: { fsPath: "/mock/settings/path" },
	asAbsolutePath: (relativePath: string) => `/mock/extension/path/${relativePath}`,
	extension: { packageJSON: { version: "1.0.0" } },
} as unknown as vscode.ExtensionContext

/** One connected server with a tool and a resource: the long prompt would advertise it. */
const mcpHub = {
	getServers: () => [
		{
			name: "docs-server",
			disabled: false,
			resources: [{ uri: "docs://index", name: "Docs index" }],
			tools: [{ name: "lookup", description: "Look a symbol up.", inputSchema: { type: "object" } }],
		},
	],
	isConnecting: false,
} as unknown as McpHub

/** One skill in every mode: the long prompt would list it. */
const skillsManager = {
	getSkillsForMode: () => [
		{
			name: "release-notes",
			description: "Write release notes from the git log.",
			path: "/home/user/.roo/skills/release-notes/SKILL.md",
			source: "global" as const,
		},
	],
} as unknown as SkillsManager

const COMPACT: SystemPromptSettings = {
	todoListEnabled: true,
	useAgentRules: true,
	newTaskRequireTodos: false,
	compactProfile: true,
}

const BUILT_IN_MODES = modes.map((mode) => mode.slug)

interface BuildExtras {
	settings?: SystemPromptSettings
	customModes?: ModeConfig[]
	language?: string
}

function build(mode: string, extras: BuildExtras = {}): Promise<string> {
	return SYSTEM_PROMPT({
		context: mockContext,
		cwd: CWD,
		mode: mode as never,
		mcpHub,
		skillsManager,
		experiments: { deferredTools: true },
		customModes: extras.customModes,
		language: "language" in extras ? extras.language : "en",
		settings: extras.settings ?? COMPACT,
	})
}

/**
 * The compact prompt with no user content at all: each built-in mode replaced
 * by a custom mode with the same slug and groups but no role definition and no
 * instructions, and an empty language, so neither MODE nor USER'S CUSTOM
 * INSTRUCTIONS renders. What is left is exactly what the extension writes.
 */
function buildWithoutUserContent(mode: string): Promise<string> {
	const bare = modes.map((m) => ({ ...m, roleDefinition: "", customInstructions: undefined }))
	return build(mode, { customModes: bare, language: "" })
}

/** Snapshot files store en and em dashes as escapes (see compact-off-golden.spec.ts). */
function pinnable(text: string): string {
	expect(text).not.toMatch(/\\u201[34]/)
	return text.replace(/[\u2013\u2014]/g, (dash) => `\\u${dash.charCodeAt(0).toString(16)}`)
}

beforeAll(() => {
	initMemoryPaths("/mock/settings/path", () => ({}))
})

afterAll(() => {
	resetMemoryPaths()
})

afterEach(() => {
	memoryIndex.present = true
})

describe("compact system prompt: budget", () => {
	it.each(BUILT_IN_MODES)(
		"stays within 4,000 characters without user content and memory index, %s mode",
		async (mode) => {
			memoryIndex.present = false
			const prompt = await buildWithoutUserContent(mode)

			// Not vacuous: the memory instruction is counted, the user's content is not there.
			expect(prompt).toContain("====\n\nMEMORY")
			expect(prompt).not.toContain("MEMORY.md:\n")
			expect(prompt).not.toContain("====\n\nMODE\n\n")
			expect(prompt).not.toContain("====\n\nUSER'S CUSTOM INSTRUCTIONS")

			expect(prompt.length).toBeLessThanOrEqual(BUDGET_CHARS)
		},
	)

	it("gives the memory index in the compact line format, capped at 6,000 characters at a line boundary", async () => {
		const prompt = await build("code")
		const start = prompt.indexOf("MEMORY.md:\n")
		const noteStart = prompt.indexOf("\n[MEMORY.md is longer", start)
		expect(start).toBeGreaterThan(-1)
		expect(noteStart).toBeGreaterThan(start)

		const body = prompt.slice(start + "MEMORY.md:\n".length, noteStart)
		const compact = compactMemoryIndex(MEMORY_INDEX_FIXTURE)
		expect(compact.length).toBeGreaterThan(6_000)
		expect(body.length).toBeLessThanOrEqual(6_000)
		expect(compact.startsWith(body)).toBe(true)
		expect(compact.charAt(body.length)).toBe("\n")
		expect(body.split("\n")[0]).toBe(
			"- note_01.md: a fixed memory entry that keeps the index above the compact cap",
		)
		expect(prompt).not.toContain("note_80.md")
		expect(prompt.slice(noteStart)).toContain(`call search_files with path "${MEMORY_ROOT}`)
	})

	it("is a fraction of the long prompt for the same inputs", async () => {
		const compact = await build("code")
		const long = await build("code", { settings: { ...COMPACT, compactProfile: false } })

		expect(compact.length * 3).toBeLessThan(long.length)
	})
})

describe("compact system prompt: what it leaves out", () => {
	it.each(BUILT_IN_MODES)("has no MCP, skills or deferred-tools text, %s mode", async (mode) => {
		const prompt = await buildWithoutUserContent(mode)

		expect(prompt).not.toMatch(/\bMCP\b/)
		expect(prompt).not.toContain("docs-server")
		expect(prompt).not.toContain("SKILLS")
		expect(prompt).not.toContain("release-notes")
		expect(prompt).not.toContain("Deferred tools")
		expect(prompt).not.toContain("tools_load")
		for (const hidden of ["apply_diff", "update_todo_list", "new_task", "run_parallel_tasks", "read_artifact"]) {
			expect(prompt).not.toContain(hidden)
		}
	})

	it("proves the long prompt does carry those sections for the same inputs", async () => {
		const long = await build("code", { settings: { ...COMPACT, compactProfile: false } })

		expect(long).toContain("====\n\nMCP SERVERS")
		expect(long).toContain("====\n\nAVAILABLE SKILLS")
		expect(long).toContain("Deferred tools")
	})

	it.each(BUILT_IN_MODES)("contains no en or em dash of its own, %s mode", async (mode) => {
		expect(await buildWithoutUserContent(mode)).not.toMatch(/[\u2013\u2014]/)
	})
})

describe("compact system prompt: what it teaches", () => {
	it("states the compact tool contract and the dated-entry rule", async () => {
		const prompt = await buildWithoutUserContent("code")

		expect(prompt).toContain("Call one tool per message. Then stop and wait for its result.")
		expect(prompt).toContain("Read a file with read_file before you change it.")
		expect(prompt).toContain("read_file shows the lines without line numbers")
		expect(prompt).toContain("Copy old_string exactly from the read_file output")
		expect(prompt).toContain("Use write_to_file only for a new file or to rewrite a whole file.")
		expect(prompt).toContain('"Today" is the date in "Current time" in environment_details.')
		expect(prompt).toContain("If that heading does not exist yet, create it")
		expect(prompt).toContain("read the changed lines again and fix them before you finish")
		expect(prompt).toContain("Finish every task with attempt_completion.")
		expect(prompt).toContain("This holds in every mode, also when you only answer a question.")
		expect(prompt).toContain("only when you cannot do the task otherwise")
		expect(prompt).toContain("Reply in the user's language.")
	})

	it("writes the example tool arguments as valid JSON with the edit parameters", async () => {
		const prompt = await buildWithoutUserContent("code")
		const line = prompt.split("\n").find((l) => l.startsWith('{"file_path"'))
		expect(line).toBeDefined()

		const args = JSON.parse(line!) as Record<string, string>
		expect(Object.keys(args)).toEqual(["file_path", "old_string", "new_string"])
		// The old text is kept and the new date heading follows it.
		expect(args.new_string.startsWith(args.old_string)).toBe(true)
		expect(args.new_string).toContain("\n\n## 2025-03-14\n- Sent the report")
	})

	it("lists every mode in one line with its slug and name", async () => {
		const prompt = await build("code")

		expect(prompt).toContain("To change mode, call switch_mode with the mode's slug.")
		for (const mode of modes) {
			expect(prompt).toContain(`\n- ${mode.slug}: ${mode.name}`)
		}
	})

	it("states the missing tools of ask and orchestrator and none for code", async () => {
		const ask = await build("ask")
		const orchestrator = await build("orchestrator")
		const code = await build("code")

		expect(ask).toContain(
			"====\n\nTOOLS IN THIS MODE\n\nThis mode cannot edit files or run commands. If the task needs that, call switch_mode to a mode that can, for example code.",
		)
		expect(orchestrator).toContain("This mode cannot read files, edit files or run commands.")
		expect(code).not.toContain("TOOLS IN THIS MODE")
	})

	it("tells the model to report instead of switching when switch_mode is removed", async () => {
		const prompt = await build("ask", { settings: { ...COMPACT, removedTools: ["switch_mode"] } })

		expect(prompt).toContain("say in attempt_completion that this mode cannot do it")
		expect(prompt).not.toContain("call switch_mode to a mode that can")
	})

	it("adds the vendor confidentiality rule for a stealth model only", async () => {
		const stealth = await build("code", { settings: { ...COMPACT, isStealthModel: true } })
		const plain = await build("code")

		expect(stealth).toContain("====\n\nVENDOR CONFIDENTIALITY")
		expect(plain).not.toContain("VENDOR CONFIDENTIALITY")
	})

	it("keeps the user's own content: role, mode instructions and language", async () => {
		const orchestrator = await build("orchestrator")
		const builtIn = modes.find((m) => m.slug === "orchestrator")!

		expect(orchestrator).toContain(`====\n\nMODE\n\n${builtIn.roleDefinition}`)
		expect(orchestrator).toContain(`Mode-specific Instructions:\n${builtIn.customInstructions}`)
		expect(orchestrator).toContain("Language Preference:")
	})
})

describe("compact system prompt: full text per built-in mode", () => {
	it.each(BUILT_IN_MODES)("%s mode", async (mode) => {
		const prompt = await build(mode)

		await expect(pinnable(prompt)).toMatchFileSnapshot(`${SNAPSHOT_DIR}/system-prompt.${mode}.snap`)
	})
})
