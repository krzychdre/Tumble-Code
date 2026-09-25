import fs from "fs"
import path from "path"

// WorktreesView renders t("worktrees:multiRootNotSupported") and t("worktrees:gitRoot"). The Roo to Tumble rebrand
// rewrote "Root" inside those key names, so every locale defined "multiTumbletNotSupported" and "gitTumblet"
// instead and the view showed the raw key. This pins the names the component actually asks for.
const localesDir = path.join(__dirname, "..", "locales")
const languages = fs.readdirSync(localesDir).filter((name) => fs.statSync(path.join(localesDir, name)).isDirectory())

describe("worktrees locale keys used by WorktreesView", () => {
	it.each(languages)("%s defines multiRootNotSupported and gitRoot", (language) => {
		const worktrees = JSON.parse(fs.readFileSync(path.join(localesDir, language, "worktrees.json"), "utf8"))

		expect(typeof worktrees.multiRootNotSupported).toBe("string")
		expect(typeof worktrees.gitRoot).toBe("string")
		expect(worktrees).not.toHaveProperty("multiTumbletNotSupported")
		expect(worktrees).not.toHaveProperty("gitTumblet")
	})

	it("WorktreesView still asks for exactly these keys", () => {
		const view = fs.readFileSync(
			path.join(__dirname, "..", "..", "components", "worktrees", "WorktreesView.tsx"),
			"utf8",
		)

		expect(view).toContain('t("worktrees:multiRootNotSupported")')
		expect(view).toContain('t("worktrees:gitRoot")')
	})
})
