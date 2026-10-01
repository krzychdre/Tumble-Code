import * as os from "os"
import * as path from "path"

import { getWorkspacePath } from "../../../utils/path"
import { modeRulesDir } from "../modeRulesDir"

vi.mock("../../../utils/path", () => ({ getWorkspacePath: vi.fn() }))

describe("modeRulesDir", () => {
	const workspace = path.join(path.sep, "work", "project")

	it("puts a global mode's rules under ~/.roo, with or without a workspace", async () => {
		const expected = path.join(os.homedir(), ".roo", "rules-review")

		vi.mocked(getWorkspacePath).mockReturnValue(workspace)
		expect(await modeRulesDir("review", "global")).toBe(expected)

		vi.mocked(getWorkspacePath).mockReturnValue("")
		expect(await modeRulesDir("review", "global")).toBe(expected)
	})

	it("puts a project mode's rules under the workspace .roo", async () => {
		vi.mocked(getWorkspacePath).mockReturnValue(workspace)
		expect(await modeRulesDir("review", "project")).toBe(path.join(workspace, ".roo", "rules-review"))
	})

	it("has no project rules folder when no workspace is open (never a relative path)", async () => {
		vi.mocked(getWorkspacePath).mockReturnValue("")
		expect(await modeRulesDir("review", "project")).toBeUndefined()
	})
})
