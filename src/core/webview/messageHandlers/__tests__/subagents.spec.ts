// npx vitest run core/webview/messageHandlers/__tests__/subagents.spec.ts

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import type { ClineMessage } from "@tumble-code/types"

// `../../../utils/storage` reads the custom storage path from the VS Code
// configuration; an empty one keeps the transcripts under the temp dir.
vi.mock("vscode", () => ({
	workspace: { getConfiguration: () => ({ get: () => "" }) },
	window: { showErrorMessage: vi.fn() },
}))

import type { HandlerContext } from "../context"
import { subagentsHandlers } from "../subagents"

const said = (text: string, ts: number): ClineMessage => ({ ts, type: "say", say: "text", text })

function makeContext(globalStoragePath: string, live?: { clineMessages: ClineMessage[] }) {
	const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
	const provider = {
		globalStoragePath,
		postMessageToWebview,
		getBackgroundTask: (id: string) => (id === "child-1" ? live : undefined),
		subagentRegistry: {
			watch: vi.fn(),
			get: (id: string) => (id === "child-1" ? { parentTaskId: "parent-1" } : undefined),
		},
	}
	return { ctx: { provider } as unknown as HandlerContext, postMessageToWebview, provider }
}

async function writeJson(filePath: string, value: unknown) {
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.writeFile(filePath, JSON.stringify(value))
}

describe("subscribeSubagentMessages", () => {
	let tmpRoot: string

	beforeEach(async () => {
		tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "subagents-handler-"))
	})

	it("sends a live child's messages", async () => {
		const { ctx, postMessageToWebview } = makeContext(tmpRoot, { clineMessages: [said("working", 1)] })

		await subagentsHandlers.subscribeSubagentMessages!(ctx, {
			type: "subscribeSubagentMessages",
			taskId: "child-1",
		})

		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "subagentMessages",
			sourceTaskId: "child-1",
			subagentMessages: [said("working", 1)],
		})
	})

	// A finished child keeps its own task directory: the panel reads its
	// messages there, like any task's.
	it("sends a finished child's messages from its own task directory", async () => {
		await writeJson(path.join(tmpRoot, "tasks", "child-1", "ui_messages.json"), [said("own", 1)])
		await writeJson(path.join(tmpRoot, "tasks", "parent-1", "subagents", "child-1.json"), [said("legacy", 1)])
		const { ctx, postMessageToWebview } = makeContext(tmpRoot)

		await subagentsHandlers.subscribeSubagentMessages!(ctx, {
			type: "subscribeSubagentMessages",
			taskId: "child-1",
		})

		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "subagentMessages",
			sourceTaskId: "child-1",
			subagentMessages: [said("own", 1)],
		})
	})

	// Older fan-outs deleted the child's directory and kept a copy under the parent.
	it("falls back to the copy kept under the parent by older runs", async () => {
		await writeJson(path.join(tmpRoot, "tasks", "parent-1", "subagents", "child-1.json"), [
			said("read the file", 1),
			said("done", 2),
		])
		const { ctx, postMessageToWebview } = makeContext(tmpRoot)

		await subagentsHandlers.subscribeSubagentMessages!(ctx, {
			type: "subscribeSubagentMessages",
			taskId: "child-1",
		})

		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "subagentMessages",
			sourceTaskId: "child-1",
			subagentMessages: [said("read the file", 1), said("done", 2)],
		})
		// Reading must not leave an empty task directory behind for the old run.
		await expect(fs.access(path.join(tmpRoot, "tasks", "child-1"))).rejects.toThrow()
	})

	it("sends an empty snapshot for a child with neither a live task nor stored messages", async () => {
		const { ctx, postMessageToWebview } = makeContext(tmpRoot)

		await subagentsHandlers.subscribeSubagentMessages!(ctx, {
			type: "subscribeSubagentMessages",
			taskId: "child-1",
		})

		expect(postMessageToWebview).toHaveBeenCalledWith(expect.objectContaining({ subagentMessages: [] }))
		await expect(fs.access(path.join(tmpRoot, "tasks"))).rejects.toThrow()
	})

	// The id comes from the webview and names a directory.
	it("rejects an id that leaves the tasks directory", async () => {
		await writeJson(path.join(tmpRoot, "ui_messages.json"), [said("secret", 1)])
		const { ctx, postMessageToWebview, provider } = makeContext(tmpRoot)

		for (const taskId of ["..", "../x", "a/b", ".hidden"]) {
			await subagentsHandlers.subscribeSubagentMessages!(ctx, { type: "subscribeSubagentMessages", taskId })
		}

		expect(postMessageToWebview).not.toHaveBeenCalled()
		expect(provider.subagentRegistry.watch).not.toHaveBeenCalled()
	})
})
