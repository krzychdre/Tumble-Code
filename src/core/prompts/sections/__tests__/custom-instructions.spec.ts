// cd src && ./node_modules/.bin/vitest run core/prompts/sections/__tests__/custom-instructions.spec.ts

// Real rule files in a temp directory (home and project); only os.homedir and
// the ripgrep process that finds subfolder .roo directories are replaced, and
// fs.readFile is a pass-through a test can make fail once.

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { addCustomInstructions, loadRuleFiles } from "../custom-instructions"
import { executeRipgrep } from "../../../../services/search/file-search"

const dirs = vi.hoisted(() => ({ home: "" }))

vi.mock("os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("os")>()
	const homedir = () => dirs.home
	return { ...actual, homedir, default: { ...actual, homedir } }
})

vi.mock("fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs/promises")>()
	const api = { ...actual, readFile: vi.fn(actual.readFile) }
	return { ...api, default: api }
})

vi.mock("../../../../services/search/file-search", () => ({ executeRipgrep: vi.fn(async () => []) }))

const onWindows = process.platform === "win32"

/** What ripgrep lists for the files under subfolder .roo directories. */
const ripgrepFinds = (...relativePaths: string[]) =>
	vi.mocked(executeRipgrep).mockResolvedValue(relativePaths.map((p) => ({ type: "file", path: p, label: p })) as any)

describe("custom instructions", () => {
	let root: string
	let cwd: string

	const write = async (relative: string, content: string, base = cwd) => {
		const filePath = path.join(base, relative)
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, content)
		return filePath
	}
	const header = (filePath: string) => `# Rules from ${path.relative(cwd, filePath)}:`

	beforeEach(async () => {
		root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "custom-instructions-")))
		dirs.home = path.join(root, "home")
		cwd = path.join(root, "project")
		await fs.mkdir(cwd, { recursive: true })
	})

	afterEach(async () => {
		vi.mocked(fs.readFile).mockClear()
		vi.mocked(executeRipgrep).mockResolvedValue([])
		await fs.rm(root, { recursive: true, force: true })
	})

	describe("loadRuleFiles", () => {
		it("returns nothing without any rules", async () => {
			expect(await loadRuleFiles(cwd)).toBe("")
		})

		it("lists the global, then the project .roo/rules files, nested ones included, sorted by name", async () => {
			const global = await write(".roo/rules/global.md", "global rule", dirs.home)
			const b = await write(".roo/rules/b.md", "  rule b  \n")
			const a = await write(".roo/rules/nested/deeper/A.md", "rule a")

			expect(await loadRuleFiles(cwd)).toBe(
				"\n# Rules from .roo directories:\n\n" +
					`${header(global)}\nglobal rule\n\n${header(a)}\nrule a\n\n${header(b)}\nrule b`,
			)
		})

		it("orders files that share a name by their full path", async () => {
			const second = await write(".roo/rules/z/same.md", "z")
			const first = await write(".roo/rules/a/same.md", "a")

			expect(await loadRuleFiles(cwd)).toContain(`${header(first)}\na\n\n${header(second)}\nz`)
		})

		it("leaves out cache and system files", async () => {
			for (const name of [".DS_Store", "notes.log", "rule.md.swp", "Thumbs.db", "old.bak"]) {
				await write(`.roo/rules/${name}`, "noise")
			}
			const kept = await write(".roo/rules/kept.md", "kept")

			expect(await loadRuleFiles(cwd)).toBe(`\n# Rules from .roo directories:\n\n${header(kept)}\nkept`)
		})

		it.each([
			[".roorules", { ".roorules": "roo rules", ".clinerules": "cline rules" }],
			[".clinerules", { ".clinerules": "cline rules" }],
		])("falls back to %s when the rules folders hold no files", async (file, files) => {
			await fs.mkdir(path.join(cwd, ".roo", "rules"), { recursive: true })
			for (const [name, content] of Object.entries(files)) await write(name, content)

			expect(await loadRuleFiles(cwd)).toBe(`\n# Rules from ${file}:\n${files[file as keyof typeof files]}\n`)
		})

		it("treats a .roorules directory as no file", async () => {
			await fs.mkdir(path.join(cwd, ".roorules"))

			expect(await loadRuleFiles(cwd)).toBe("")
		})

		it("throws a read error other than a missing file", async () => {
			await write(".roorules", "rules")
			vi.mocked(fs.readFile).mockRejectedValueOnce(Object.assign(new Error("EACCES"), { code: "EACCES" }))

			await expect(loadRuleFiles(cwd)).rejects.toThrow("EACCES")
		})

		it("reads the rules of subfolder .roo directories only when enabled", async () => {
			const own = await write(".roo/rules/own.md", "own")
			const sub = await write("packages/app/.roo/rules/sub.md", "sub")
			ripgrepFinds("packages/app/.roo/rules/sub.md")

			expect(await loadRuleFiles(cwd)).not.toContain("sub")
			expect(await loadRuleFiles(cwd, true)).toBe(
				`\n# Rules from .roo directories:\n\n${header(own)}\nown\n\n${header(sub)}\nsub`,
			)
		})

		describe.skipIf(onWindows)("symlinks", () => {
			it("follows file and folder links, sorts a file link by its own name and skips a dangling one", async () => {
				const target = await write("elsewhere/zz-target.md", "linked file")
				await write("shared/inner.md", "linked folder")
				await fs.mkdir(path.join(cwd, ".roo", "rules"), { recursive: true })
				await fs.symlink(target, path.join(cwd, ".roo", "rules", "a-link.md"))
				await fs.symlink(path.join(cwd, "shared"), path.join(cwd, ".roo", "rules", "folder"))
				await fs.symlink(path.join(cwd, "missing.md"), path.join(cwd, ".roo", "rules", "dangling.md"))
				const plain = await write(".roo/rules/b.md", "plain")

				expect(await loadRuleFiles(cwd)).toBe(
					"\n# Rules from .roo directories:\n\n" +
						[
							`${header(target)}\nlinked file`,
							`${header(plain)}\nplain`,
							`${header(path.join(cwd, "shared", "inner.md"))}\nlinked folder`,
						].join("\n\n"),
				)
			})

			// A relative link inside a linked folder points next to the link's real location.
			it("resolves a relative link inside a linked folder against the folder's real path", async () => {
				await write("real/target.md", "relative target")
				await fs.symlink("target.md", path.join(cwd, "real", "link.md"))
				await fs.mkdir(path.join(cwd, ".roo", "rules"), { recursive: true })
				await fs.symlink(path.join(cwd, "real"), path.join(cwd, ".roo", "rules", "real"))

				expect(await loadRuleFiles(cwd)).toContain("relative target")
			})

			it("stops at a link cycle", async () => {
				await fs.mkdir(path.join(cwd, ".roo", "rules"), { recursive: true })
				await fs.symlink(path.join(cwd, ".roo", "rules"), path.join(cwd, ".roo", "rules", "loop"))
				await write(".roo/rules/rule.md", "rule")

				expect(await loadRuleFiles(cwd)).toContain("rule")
			})
		})
	})

	describe("addCustomInstructions", () => {
		it("returns nothing without any instructions or rules", async () => {
			expect(await addCustomInstructions("", "", cwd, "code")).toBe("")
		})

		it("puts language, global, mode instructions and the rules in that order", async () => {
			const modeRule = await write(".roo/rules-code/mode.md", "mode rule")
			const rule = await write(".roo/rules/rule.md", "generic rule")
			await write("AGENTS.md", "agents")

			const result = await addCustomInstructions("  mode text  ", "  global text  ", cwd, "code", {
				language: "fr",
				rooIgnoreInstructions: "# .rooignore\nsecret/",
			})

			expect(result).toBe(`
====

USER'S CUSTOM INSTRUCTIONS

The following additional instructions are provided by the user, and should be followed to the best of your ability.

Language Preference:
Write your replies in the language the user writes to you in. If the user's language is unclear (for example the message contains only code, a log or a file path), write in the "Français" (fr) language. If the user asks you for a specific language, follow that request instead of both rules above.

Global Instructions:
global text

Mode-specific Instructions:
mode text

Rules:

# Rules from rules-code directories:

${header(modeRule)}
mode rule

# .rooignore
secret/

# Agent Rules Standard (AGENTS.md):
agents

# Rules from .roo directories:

${header(rule)}
generic rule
`)
		})

		it("names an unknown language code as it is", async () => {
			expect(await addCustomInstructions("", "", cwd, "code", { language: "xx-YY" })).toContain(
				'write in the "xx-YY" (xx-YY) language',
			)
		})

		it("reads the mode rules from the global and the project rules-<mode> folders", async () => {
			const global = await write(".roo/rules-code/g.md", "global mode rule", dirs.home)
			const project = await write(".roo/rules-code/p.md", "project mode rule")

			expect(await addCustomInstructions("", "", cwd, "code")).toContain(
				`# Rules from rules-code directories:\n\n${header(global)}\nglobal mode rule\n\n${header(project)}\nproject mode rule`,
			)
		})

		it.each([
			[".roorules-code", { ".roorules-code": "roo mode rule", ".clinerules-code": "cline mode rule" }],
			[".clinerules-code", { ".clinerules-code": "cline mode rule" }],
		])("falls back to %s without rules-<mode> folders", async (file, files) => {
			for (const [name, content] of Object.entries(files)) await write(name, content)

			expect(await addCustomInstructions("", "", cwd, "code")).toContain(
				`# Rules from ${file}:\n${files[file as keyof typeof files]}`,
			)
		})

		it("ignores mode rules without a mode and a mode rule path that is a directory", async () => {
			await fs.mkdir(path.join(cwd, ".roorules-code"))
			await write(".clinerules-", "no mode")

			expect(await addCustomInstructions("", "", cwd, "code")).toBe("")
			expect(await addCustomInstructions("", "", cwd, "")).toBe("")
		})

		describe("AGENTS.md", () => {
			it.each([
				[
					"AGENTS.md",
					{ "AGENTS.md": "plural", "AGENT.md": "singular" },
					"# Agent Rules Standard (AGENTS.md):\nplural",
				],
				["AGENT.md", { "AGENT.md": "singular" }, "# Agent Rules Standard (AGENT.md):\nsingular"],
				[
					"AGENTS.local.md next to AGENTS.md",
					{ "AGENTS.md": "base", "AGENTS.local.md": "personal" },
					"# Agent Rules Standard (AGENTS.md):\nbase\n\n# Agent Rules Local (AGENTS.local.md):\npersonal",
				],
				[
					"AGENTS.local.md alone",
					{ "AGENTS.local.md": "personal" },
					"# Agent Rules Local (AGENTS.local.md):\npersonal",
				],
			])("reads %s", async (_label, files, expected) => {
				for (const [name, content] of Object.entries(files)) await write(name, content)

				const result = await addCustomInstructions("", "", cwd, "code")

				expect(result.slice(result.indexOf("Rules:"))).toBe(`Rules:\n\n${expected}\n`)
			})

			it("skips AGENTS.md when useAgentRules is off", async () => {
				await write("AGENTS.md", "agents")

				expect(
					await addCustomInstructions("", "", cwd, "code", { settings: { useAgentRules: false } as any }),
				).toBe("")
			})

			it("reads the AGENTS.md of subfolders with a .roo folder, with their path, only when enabled", async () => {
				await write("AGENTS.md", "root agents")
				await write("packages/app/AGENTS.md", "app agents")
				await write("packages/app/.roo/rules/r.md", "app rule")
				ripgrepFinds("packages/app/.roo/rules/r.md")
				const settings = { enableSubfolderRules: true } as any

				expect(await addCustomInstructions("", "", cwd, "code")).not.toContain("app agents")
				expect(await addCustomInstructions("", "", cwd, "code", { settings })).toContain(
					`# Agent Rules Standard (AGENTS.md):\nroot agents\n\n# Agent Rules Standard (AGENTS.md) from ${path.join("packages", "app")}:\napp agents`,
				)
			})

			it.skipIf(onWindows)("follows a symlinked AGENTS.md", async () => {
				const target = await write("docs/agents.md", "linked agents")
				await fs.symlink(target, path.join(cwd, "AGENTS.md"))

				expect(await addCustomInstructions("", "", cwd, "code")).toContain("linked agents")
			})
		})
	})
})
