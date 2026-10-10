// npx vitest run services/roo-config/__tests__/roo-directory-precedence.spec.ts
//
// Precedence matrix for every `.roo` directory kind, run against a REAL
// temporary file system (a fake home directory plus a fake workspace). The
// matrix pins the order the user sees today.

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const state = vi.hoisted(() => ({ home: "", ripgrepCalls: 0 }))

vi.mock("os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("os")>()
	const homedir = () => state.home
	return { ...actual, homedir, default: { ...actual, homedir } }
})

// ripgrep is replaced by a synchronous walk of the temporary workspace that
// returns every file inside any `.roo` directory, like `rg --files -g **/.roo/**`.
vi.mock("../../search/file-search", () => ({
	executeRipgrep: vi.fn(async ({ workspacePath }: { workspacePath: string }) => {
		state.ripgrepCalls++
		const results: Array<{ path: string; type: "file" }> = []
		const walk = (dir: string) => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				if (entry.name === "node_modules" || entry.name === ".git") continue
				const full = path.join(dir, entry.name)
				if (entry.isDirectory()) {
					walk(full)
				} else {
					const rel = path.relative(workspacePath, full)
					if (rel.split(path.sep).includes(".roo")) {
						results.push({ path: rel, type: "file" })
					}
				}
			}
		}
		walk(workspacePath)
		return results
	}),
}))

import { addCustomInstructions, loadRuleFiles } from "../../../core/prompts/sections/custom-instructions"
import { SkillsManager } from "../../skills/SkillsManager"
import { invalidateRooDirectoryCache } from "../index"

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true })
	fs.writeFileSync(file, content)
}

const skillMd = (name: string, description: string) =>
	`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`

describe(".roo directory precedence matrix", () => {
	let root: string
	let cwd: string
	let globalRoo: string
	let projectRoo: string

	beforeEach(() => {
		// realpathSync.native, not realpathSync: on the Windows CI runner TEMP is
		// an 8.3 short path (C:\Users\RUNNER~1\...). The JS realpathSync keeps
		// the short name, while SkillsManager resolves skill directories with
		// fs.promises.realpath (native), which expands it to the long name
		// (C:\Users\runneradmin\...). path.relative(root, skill.path) then
		// climbed out of root instead of returning "home\...".
		root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "roo-precedence-"))
		state.home = path.join(root, "home")
		state.ripgrepCalls = 0
		cwd = path.join(root, "workspace")
		globalRoo = path.join(state.home, ".roo")
		projectRoo = path.join(cwd, ".roo")
		fs.mkdirSync(cwd, { recursive: true })
		fs.mkdirSync(state.home, { recursive: true })
		invalidateRooDirectoryCache?.()
	})

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true })
	})

	describe("rules (concatenated, lowest precedence first)", () => {
		beforeEach(() => {
			write(path.join(globalRoo, "rules", "g.md"), "GLOBAL-RULE")
			write(path.join(projectRoo, "rules", "p.md"), "PROJECT-RULE")
			write(path.join(cwd, "pkg-b", ".roo", "rules", "b.md"), "SUB-B-RULE")
			write(path.join(cwd, "pkg-a", ".roo", "rules", "a.md"), "SUB-A-RULE")
		})

		it("orders generic rules global, project, then subfolders alphabetically", async () => {
			const out = await loadRuleFiles(cwd, true)
			const order = ["GLOBAL-RULE", "PROJECT-RULE", "SUB-A-RULE", "SUB-B-RULE"].map((s) => out.indexOf(s))
			expect(order.every((i) => i >= 0)).toBe(true)
			expect([...order].sort((a, b) => a - b)).toEqual(order)
		})

		it("ignores subfolder rules when subfolder rules are off", async () => {
			const out = await loadRuleFiles(cwd, false)
			expect(out).toContain("GLOBAL-RULE")
			expect(out).toContain("PROJECT-RULE")
			expect(out).not.toContain("SUB-A-RULE")
		})

		it("falls back to the legacy .roorules file only when no rules directory has files", async () => {
			write(path.join(cwd, ".roorules"), "LEGACY-RULE")
			expect(await loadRuleFiles(cwd, false)).not.toContain("LEGACY-RULE")

			fs.rmSync(path.join(globalRoo, "rules"), { recursive: true })
			fs.rmSync(path.join(projectRoo, "rules"), { recursive: true })
			expect(await loadRuleFiles(cwd, false)).toContain("LEGACY-RULE")
		})
	})

	describe("mode-specific rules (resolved for the CURRENT mode on every build)", () => {
		beforeEach(() => {
			write(path.join(globalRoo, "rules", "g.md"), "GLOBAL-RULE")
			write(path.join(globalRoo, "rules-code", "g.md"), "GLOBAL-CODE-RULE")
			write(path.join(projectRoo, "rules-code", "p.md"), "PROJECT-CODE-RULE")
			write(path.join(cwd, "pkg-a", ".roo", "rules-code", "a.md"), "SUB-CODE-RULE")
			write(path.join(cwd, "pkg-a", ".roo", "rules-architect", "a.md"), "SUB-ARCHITECT-RULE")
		})

		const build = (mode: string) =>
			addCustomInstructions("", "", cwd, mode, {
				settings: { enableSubfolderRules: true, useAgentRules: true } as any,
			})

		it("orders mode rules global, project, subfolder and puts them before generic rules", async () => {
			const out = await build("code")
			const order = ["GLOBAL-CODE-RULE", "PROJECT-CODE-RULE", "SUB-CODE-RULE", "GLOBAL-RULE"].map((s) =>
				out.indexOf(s),
			)
			expect(order.every((i) => i >= 0)).toBe(true)
			expect([...order].sort((a, b) => a - b)).toEqual(order)
			expect(out).not.toContain("SUB-ARCHITECT-RULE")
		})

		it("switching modes between two builds picks the new mode's rules", async () => {
			const code = await build("code")
			const architect = await build("architect")

			expect(code).toContain("SUB-CODE-RULE")
			expect(code).not.toContain("SUB-ARCHITECT-RULE")
			expect(architect).toContain("SUB-ARCHITECT-RULE")
			expect(architect).not.toContain("SUB-CODE-RULE")
			expect(architect).not.toContain("PROJECT-CODE-RULE")
		})

		it("scans the workspace for subfolder .roo directories once across two prompt builds (P1)", async () => {
			await build("code")
			await build("architect")

			// Today: 3 scans per build (mode rules, AGENTS.md, generic rules) = 6.
			expect(state.ripgrepCalls).toBe(1)
		})

		it("rescans after the cache is invalidated (a new subfolder .roo appears)", async () => {
			await build("code")
			write(path.join(cwd, "pkg-c", ".roo", "rules-code", "c.md"), "NEW-SUB-CODE-RULE")
			invalidateRooDirectoryCache()

			expect(await build("code")).toContain("NEW-SUB-CODE-RULE")
		})
	})

	describe("AGENTS.md (concatenated: workspace root first, then subfolders with a .roo)", () => {
		it("orders the root AGENTS.md before subfolder ones", async () => {
			write(path.join(cwd, "AGENTS.md"), "ROOT-AGENTS")
			write(path.join(cwd, "pkg-a", "AGENTS.md"), "SUB-AGENTS")
			write(path.join(cwd, "pkg-a", ".roo", "rules", "a.md"), "x")

			const out = await addCustomInstructions("", "", cwd, "code", {
				settings: { enableSubfolderRules: true, useAgentRules: true } as any,
			})
			expect(out.indexOf("ROOT-AGENTS")).toBeGreaterThanOrEqual(0)
			expect(out.indexOf("SUB-AGENTS")).toBeGreaterThan(out.indexOf("ROOT-AGENTS"))
		})
	})

	describe("skills (override: .agents global < .agents project < .roo global < .roo project; project beats global; mode-specific beats generic)", () => {
		const skillPath = async (mode: string, name: string) => {
			const provider = { cwd, customModesManager: { getCustomModes: async () => [] } }
			const manager = new SkillsManager(provider as any)
			await manager.discoverSkills()
			const skill = manager.getSkillsForMode(mode).find((s) => s.name === name)
			await manager.dispose()
			return skill ? path.relative(root, skill.path) : undefined
		}

		it("prefers .roo over .agents within the same source, and project over global", async () => {
			write(path.join(state.home, ".agents", "skills", "lint", "SKILL.md"), skillMd("lint", "global agents"))
			write(path.join(globalRoo, "skills", "lint", "SKILL.md"), skillMd("lint", "global roo"))
			expect(await skillPath("code", "lint")).toBe(path.join("home", ".roo", "skills", "lint", "SKILL.md"))

			write(path.join(cwd, ".agents", "skills", "lint", "SKILL.md"), skillMd("lint", "project agents"))
			expect(await skillPath("code", "lint")).toBe(
				path.join("workspace", ".agents", "skills", "lint", "SKILL.md"),
			)

			write(path.join(projectRoo, "skills", "lint", "SKILL.md"), skillMd("lint", "project roo"))
			expect(await skillPath("code", "lint")).toBe(path.join("workspace", ".roo", "skills", "lint", "SKILL.md"))
		})

		it("mode-specific beats generic within a source, but a project generic beats a global mode-specific", async () => {
			write(path.join(globalRoo, "skills-code", "fmt", "SKILL.md"), skillMd("fmt", "global code"))
			write(path.join(globalRoo, "skills", "fmt", "SKILL.md"), skillMd("fmt", "global generic"))
			expect(await skillPath("code", "fmt")).toBe(path.join("home", ".roo", "skills-code", "fmt", "SKILL.md"))
			expect(await skillPath("architect", "fmt")).toBe(path.join("home", ".roo", "skills", "fmt", "SKILL.md"))

			write(path.join(projectRoo, "skills", "fmt", "SKILL.md"), skillMd("fmt", "project generic"))
			expect(await skillPath("code", "fmt")).toBe(path.join("workspace", ".roo", "skills", "fmt", "SKILL.md"))
		})
	})
})
