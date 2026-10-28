// cd src && npx vitest run core/tools/__tests__/ReadArtifactTool.search.spec.ts
// A real artifact file in a temporary storage directory; the task is a stand-in.

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { artifactCandidatePaths } from "../../artifacts/ArtifactStore"
import { ReadArtifactTool } from "../ReadArtifactTool"

describe("read_artifact search", () => {
	let storage: string
	const taskId = "task-search"
	const artifactId = "cmd-1700000000000.txt"

	beforeEach(async () => {
		storage = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-search-"))
		const [artifactPath] = artifactCandidatePaths(path.join(storage, "tasks", taskId), artifactId)
		await fs.mkdir(path.dirname(artifactPath!), { recursive: true })
		// One long unbroken token, then a line that matches the text of the pattern.
		await fs.writeFile(artifactPath!, `${"a".repeat(5000)}!\nliteral (a+)+$ here\n`)
	})

	afterEach(async () => {
		await fs.rm(storage, { recursive: true, force: true })
	})

	async function search(pattern: string): Promise<string> {
		const results: string[] = []
		const task = {
			taskId,
			consecutiveMistakeCount: 0,
			say: async () => {},
			recordToolError: () => {},
			providerRef: { deref: async () => ({ context: { globalStorageUri: { fsPath: storage } } }) },
		}
		await new ReadArtifactTool().execute(
			{ artifact_id: artifactId, search: pattern },
			task as never,
			{
				pushToolResult: (result: unknown) => void results.push(String(result)),
			} as never,
		)
		return results.join("\n")
	}

	it("searches a pattern that would backtrack forever as literal text, at once", async () => {
		const started = Date.now()
		const result = await search("(a+)+$")

		expect(Date.now() - started).toBeLessThan(2000)
		expect(result).toContain("literal (a+)+$ here")
		expect(result).not.toContain("a".repeat(100))
	})

	it("still runs an ordinary regular expression", async () => {
		expect(await search("lit\\w+")).toContain("literal (a+)+$ here")
	})
})
