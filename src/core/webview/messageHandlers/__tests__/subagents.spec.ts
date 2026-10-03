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

import { saveSubagentTranscript } from "../../../task-persistence/subagentSummariesStore"
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
	return { ctx: { provider } as unknown as HandlerContext, postMessageToWebview }
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

	// Regression: a finished child is disposed and its own directory deleted,
	// so the expanded row could show only the final message.
	it("sends a finished child's transcript kept under its parent", async () => {
		await saveSubagentTranscript(tmpRoot, "parent-1", "child-1", [said("read the file", 1), said("done", 2)])
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
	})

	it("sends an empty snapshot for a child with neither a live task nor a transcript", async () => {
		const { ctx, postMessageToWebview } = makeContext(tmpRoot)

		await subagentsHandlers.subscribeSubagentMessages!(ctx, {
			type: "subscribeSubagentMessages",
			taskId: "child-1",
		})

		expect(postMessageToWebview).toHaveBeenCalledWith(expect.objectContaining({ subagentMessages: [] }))
	})
})
