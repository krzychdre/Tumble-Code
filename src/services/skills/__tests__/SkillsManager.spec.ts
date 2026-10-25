// SkillsManager on a real temporary home and project directory; nothing of the file system is
// faked. Only the provider (cwd and custom modes) is a stand-in.

import { realpathSync } from "fs"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { SkillsManager } from "../SkillsManager"
import type { ClineProvider } from "../../../core/webview/ClineProvider"
import { logger } from "../../../utils/logging"

vi.mock("../../../i18n", () => ({
	t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}))

let root: string
let home: string
let project: string
let manager: SkillsManager
let customModes: () => Promise<unknown[]>
const savedEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }

/** Writes `<base>/<dir>/<name>/SKILL.md`; `content` is either frontmatter fields or the raw file. */
async function writeSkill(
	base: string,
	dir: string,
	name: string,
	content: Record<string, unknown> | string = {},
	body = "# Instructions\n\nDo the thing.",
) {
	const skillDir = path.join(base, dir, name)
	await fs.mkdir(skillDir, { recursive: true })
	const text =
		typeof content === "string"
			? content
			: `---\n${Object.entries({ name, description: `${name} skill`, ...content })
					.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
					.join("\n")}\n---\n\n${body}\n`
	await fs.writeFile(path.join(skillDir, "SKILL.md"), text)
	return path.join(skillDir, "SKILL.md")
}

const globalRoo = () => path.join(home, ".roo")
const projectRoo = () => path.join(project, ".roo")
const summary = () =>
	manager
		.getAllSkills()
		.map(({ name, source, modeSlugs }) => ({ name, source, modeSlugs }))
		.sort((a, b) => a.name.localeCompare(b.name))
const names = (mode: string) =>
	manager
		.getSkillsForMode(mode)
		.map((s) => `${s.name}@${s.source}`)
		.sort()

function makeManager(cwd: string | null = project) {
	return new SkillsManager({
		cwd: cwd ?? undefined,
		customModesManager: { getCustomModes: () => customModes() },
	} as unknown as ClineProvider)
}

beforeEach(async () => {
	// The long path: Windows temp dirs come as 8.3 short names (RUNNER~1), the skill paths as long ones.
	root = realpathSync.native(await fs.mkdtemp(path.join(os.tmpdir(), "skills-spec-")))
	home = path.join(root, "home")
	project = path.join(root, "project")
	await fs.mkdir(home, { recursive: true })
	await fs.mkdir(project, { recursive: true })
	// os.homedir() reads these, so ~/.roo and ~/.agents land in the temp home.
	process.env.HOME = home
	process.env.USERPROFILE = home
	customModes = async () => []
	manager = makeManager()
	vi.spyOn(logger, "error").mockImplementation(() => {})
})

afterEach(async () => {
	await manager.dispose()
	process.env.HOME = savedEnv.HOME
	process.env.USERPROFILE = savedEnv.USERPROFILE
	vi.restoreAllMocks()
	await fs.rm(root, { recursive: true, force: true })
})

describe("SkillsManager discovery", () => {
	it("finds generic and mode skills under .roo and .agents, global and project", async () => {
		await writeSkill(globalRoo(), "skills", "global-any")
		await writeSkill(globalRoo(), "skills-code", "global-code")
		await writeSkill(projectRoo(), "skills", "project-any")
		await writeSkill(path.join(home, ".agents"), "skills", "agents-global")
		await writeSkill(path.join(project, ".agents"), "skills-architect", "agents-project")

		await manager.discoverSkills()

		expect(summary()).toEqual([
			{ name: "agents-global", source: "global", modeSlugs: undefined },
			{ name: "agents-project", source: "project", modeSlugs: ["architect"] },
			{ name: "global-any", source: "global", modeSlugs: undefined },
			{ name: "global-code", source: "global", modeSlugs: ["code"] },
			{ name: "project-any", source: "project", modeSlugs: undefined },
		])
	})

	it("skips skills that break the spec and keeps the valid one", async () => {
		const skills = path.join(globalRoo(), "skills")
		await writeSkill(globalRoo(), "skills", "valid")
		await writeSkill(globalRoo(), "skills", "no-name", "---\ndescription: d\n---\nbody")
		await writeSkill(globalRoo(), "skills", "no-description", "---\nname: no-description\n---\nbody")
		await writeSkill(globalRoo(), "skills", "mismatch", { name: "other-name" })
		await writeSkill(globalRoo(), "skills", "Bad_Name", { name: "Bad_Name" })
		await writeSkill(globalRoo(), "skills", "a".repeat(65), { name: "a".repeat(65) })
		await writeSkill(globalRoo(), "skills", "blank-description", { description: "   " })
		await writeSkill(globalRoo(), "skills", "long-description", { description: "x".repeat(1025) })
		await fs.mkdir(path.join(skills, "no-skill-md"))
		await fs.writeFile(path.join(skills, "a-file"), "not a directory")

		await manager.discoverSkills()

		expect(summary().map((s) => s.name)).toEqual(["valid"])
	})

	it.each([
		["the frontmatter modeSlugs", "skills", { modeSlugs: ["code", "ask"] }, ["code", "ask"]],
		["no mode for an empty modeSlugs list", "skills-code", { modeSlugs: [] }, undefined],
		["no mode when modeSlugs holds no usable slug", "skills", { modeSlugs: ["", 5] }, undefined],
		["the legacy frontmatter mode", "skills", { mode: "ask" }, ["ask"]],
		["the directory's mode", "skills-code", {}, ["code"]],
		["modeSlugs over the directory's mode", "skills-code", { modeSlugs: ["ask"] }, ["ask"]],
	])("takes %s", async (_, dir, frontmatter, modeSlugs) => {
		await writeSkill(globalRoo(), dir, "skill", frontmatter)

		await manager.discoverSkills()

		expect(summary()).toEqual([{ name: "skill", source: "global", modeSlugs }])
	})

	it("follows a symlinked skills directory and a symlinked skill named by its link", async () => {
		const shared = path.join(root, "shared")
		await writeSkill(shared, "", "linked-dir-skill")
		await writeSkill(path.join(root, "elsewhere"), "", "original", { name: "renamed" })
		await fs.mkdir(globalRoo(), { recursive: true })
		await fs.symlink(shared, path.join(globalRoo(), "skills"), "junction")
		await fs.mkdir(path.join(projectRoo(), "skills"), { recursive: true })
		await fs.symlink(
			path.join(root, "elsewhere", "original"),
			path.join(projectRoo(), "skills", "renamed"),
			"junction",
		)

		await manager.discoverSkills()

		expect(summary().map((s) => `${s.name}@${s.source}`)).toEqual(["linked-dir-skill@global", "renamed@project"])
	})

	it("lets a .roo skill replace an .agents skill of the same name and source", async () => {
		await writeSkill(path.join(home, ".agents"), "skills", "same")
		const rooPath = await writeSkill(globalRoo(), "skills", "same")

		await manager.discoverSkills()

		expect(manager.getAllSkills().map((s) => s.path)).toEqual([rooPath])
	})

	it.each([
		[
			"custom modes",
			async () => [{ slug: "mine", name: "Mine", roleDefinition: "r", groups: [] }],
			["built-in", "custom"],
		],
		[
			"the built-in modes when custom modes cannot be read",
			async () => Promise.reject(new Error("bad yaml")),
			["built-in"],
		],
	])("scans the mode directories of %s", async (_, modes, found) => {
		customModes = modes
		await writeSkill(globalRoo(), "skills-mine", "custom")
		await writeSkill(globalRoo(), "skills-code", "built-in")

		await manager.discoverSkills()

		expect(summary().map((s) => s.name)).toEqual(found)
	})
})

describe("SkillsManager.getSkillsForMode", () => {
	it.each([
		["a project skill over a global one", ["global skills", "project skills"], "code", "project skills"],
		[
			"a mode skill over a generic one of the same source",
			["global skills", "global skills-code"],
			"code",
			"global skills-code",
		],
		["a global generic skill in any mode", ["global skills"], "debug", "global skills"],
		["no skill of another mode", ["global skills-ask"], "code", undefined],
	])("resolves %s", async (_, placements, mode, winner) => {
		for (const placement of placements) {
			const [source, dir] = placement.split(" ")
			await writeSkill(source === "global" ? globalRoo() : projectRoo(), dir, "s", { description: placement })
		}

		await manager.discoverSkills()

		expect(manager.getSkillsForMode(mode).map((s) => s.description)).toEqual(winner ? [winner] : [])
	})
})

describe("SkillsManager content and lookup", () => {
	it("returns the instructions without frontmatter, for a mode or any", async () => {
		await writeSkill(globalRoo(), "skills-code", "coder", {}, "\n# Coder\n\nWrite code.\n\n")

		await manager.discoverSkills()

		expect(await manager.getSkillContent("coder", "code")).toMatchObject({
			name: "coder",
			modeSlugs: ["code"],
			instructions: "# Coder\n\nWrite code.",
		})
		expect(await manager.getSkillContent("coder", "ask")).toBeNull()
		expect((await manager.getSkillContent("coder"))?.name).toBe("coder")
		expect(await manager.getSkillContent("nope")).toBeNull()
	})

	it("finds a skill by name, source and mode", async () => {
		await writeSkill(globalRoo(), "skills-code", "coder")
		await manager.discoverSkills()

		expect(manager.getSkill("coder", "global", "code")?.name).toBe("coder")
		expect(manager.getSkill("coder", "global")).toBeUndefined()
		expect(manager.findSkillByNameAndSource("coder", "global")?.name).toBe("coder")
		expect(manager.findSkillByNameAndSource("coder", "project")).toBeUndefined()
		expect(manager.getSkillsMetadata()).toEqual(manager.getAllSkills())
	})

	// ClineProvider starts initialize() without awaiting it, and a one-shot CLI run asks for a
	// skill in the same tick.
	it("makes a reader wait for a scan in flight instead of reporting the skill missing", async () => {
		await writeSkill(globalRoo(), "skills", "race-skill")

		const initialized = manager.initialize()
		expect(manager.getAllSkills()).toEqual([])

		expect((await manager.getSkillContent("race-skill", "code"))?.name).toBe("race-skill")
		await manager.whenReady()
		expect(names("code")).toEqual(["race-skill@global"])
		await initialized
	})

	it("keeps the previous result visible while a rescan is in flight", async () => {
		await writeSkill(globalRoo(), "skills", "kept")
		await manager.discoverSkills()

		const rescan = manager.discoverSkills()
		expect(manager.getAllSkills()).toHaveLength(1)
		await rescan

		expect(manager.getAllSkills()).toHaveLength(1)
	})

	it("is ready at once when discovery never started, and empty after dispose", async () => {
		await expect(manager.whenReady()).resolves.toBeUndefined()
		await writeSkill(globalRoo(), "skills", "gone")
		await manager.discoverSkills()

		await manager.dispose()

		expect(manager.getAllSkills()).toEqual([])
	})
})

describe("SkillsManager.createSkill", () => {
	it("writes a global skill with its title and finds it", async () => {
		const created = await manager.createSkill("my-new-skill", "global", "  Does things  ")

		expect(created).toBe(path.join(globalRoo(), "skills", "my-new-skill", "SKILL.md"))
		expect(await fs.readFile(created, "utf-8")).toBe(
			"---\nname: my-new-skill\ndescription: Does things\n---\n\n# My New Skill\n\n## Instructions\n\nAdd your skill instructions here.\n",
		)
		expect(summary()).toEqual([{ name: "my-new-skill", source: "global", modeSlugs: undefined }])
	})

	it("writes a project skill limited to modes", async () => {
		const created = await manager.createSkill("proj", "project", "d", ["code", "ask"])

		expect(created).toBe(path.join(projectRoo(), "skills", "proj", "SKILL.md"))
		expect(await fs.readFile(created, "utf-8")).toContain("modeSlugs:\n  - code\n  - ask\n---")
		expect(summary()).toEqual([{ name: "proj", source: "project", modeSlugs: ["code", "ask"] }])
	})

	it.each([
		["Bad_Name", "d", "skills:errors.name_format"],
		["-lead", "d", "skills:errors.name_format"],
		["trail-", "d", "skills:errors.name_format"],
		["dou--ble", "d", "skills:errors.name_format"],
		["a".repeat(65), "d", 'skills:errors.name_length {"maxLength":64,"length":65}'],
		["", "d", 'skills:errors.name_length {"maxLength":64,"length":0}'],
		["ok", "   ", 'skills:errors.description_length {"length":0}'],
		["ok", "x".repeat(1025), 'skills:errors.description_length {"length":1025}'],
	])("refuses the name %j with description %j", async (name, description, message) => {
		await expect(manager.createSkill(name, "global", description)).rejects.toThrow(message)
	})

	it("refuses a skill that exists, and a project skill without a workspace", async () => {
		await manager.createSkill("taken", "global", "d")

		await expect(manager.createSkill("taken", "global", "d")).rejects.toThrow("skills:errors.already_exists")
		await expect(makeManager(null).createSkill("x", "project", "d")).rejects.toThrow("skills:errors.no_workspace")
	})
})

describe("SkillsManager changing skills", () => {
	const exists = (p: string) =>
		fs.stat(p).then(
			() => true,
			() => false,
		)

	it("deletes the skill directory", async () => {
		const skillMd = await writeSkill(globalRoo(), "skills-code", "doomed")
		await manager.discoverSkills()

		await manager.deleteSkill("doomed", "global", "code")

		expect(await exists(path.dirname(skillMd))).toBe(false)
		expect(manager.getAllSkills()).toEqual([])
		await expect(manager.deleteSkill("doomed", "global", "code")).rejects.toThrow(
			'skills:errors.not_found {"name":"doomed","source":"global","modeInfo":" (mode: code)"}',
		)
	})

	it.each([
		[undefined, "code", "skills", "skills-code"],
		["code", "ask", "skills-code", "skills-ask"],
		["code", undefined, "skills-code", "skills"],
	])("moves a skill from mode %s to mode %s and removes the emptied directory", async (from, to, fromDir, toDir) => {
		await writeSkill(projectRoo(), fromDir, "mover")
		await manager.discoverSkills()

		await manager.moveSkill("mover", "project", from, to)

		expect(await exists(path.join(projectRoo(), toDir, "mover", "SKILL.md"))).toBe(true)
		expect(await exists(path.join(projectRoo(), fromDir))).toBe(false)
		expect(manager.getSkill("mover", "project", to)?.name).toBe("mover")
	})

	it("keeps a source directory that still holds other skills", async () => {
		await writeSkill(globalRoo(), "skills", "mover")
		await writeSkill(globalRoo(), "skills", "stays")
		await manager.discoverSkills()

		await manager.moveSkill("mover", "global", undefined, "code")

		expect(names("code")).toEqual(["mover@global", "stays@global"])
		expect(await exists(path.join(globalRoo(), "skills", "stays"))).toBe(true)
	})

	it("does nothing for a move to the same mode, and refuses a missing skill or a taken destination", async () => {
		await writeSkill(globalRoo(), "skills", "both")
		await writeSkill(globalRoo(), "skills-code", "both")
		await manager.discoverSkills()

		await expect(manager.moveSkill("both", "global", "code", "code")).resolves.toBeUndefined()
		await expect(manager.moveSkill("nope", "global", undefined, "code")).rejects.toThrow("skills:errors.not_found")
		await expect(manager.moveSkill("both", "global", undefined, "code")).rejects.toThrow(
			"skills:errors.already_exists",
		)
	})

	it.each([
		[
			["code", "ask"],
			["code", "ask"],
		],
		[[], undefined],
		[undefined, undefined],
	])("rewrites the modes to %j, dropping the legacy mode field", async (newModes, modeSlugs) => {
		const skillMd = await writeSkill(globalRoo(), "skills", "moded", { mode: "debug" }, "Body stays.")
		await manager.discoverSkills()

		await manager.updateSkillModes("moded", "global", newModes)

		const text = await fs.readFile(skillMd, "utf-8")
		expect(text).not.toContain("mode: debug")
		expect(text).toContain("Body stays.")
		expect(summary()).toEqual([{ name: "moded", source: "global", modeSlugs }])
	})

	it("refuses to update the modes of a missing skill", async () => {
		await expect(manager.updateSkillModes("nope", "global", ["code"])).rejects.toThrow("skills:errors.not_found")
	})
})
