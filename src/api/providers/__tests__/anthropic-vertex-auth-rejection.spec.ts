// TEST-11: @anthropic-ai/vertex-sdk calls googleAuth.getClient() in its
// constructor and parks the promise until the first request. When the Google
// credentials cannot be loaded, that promise rejects before anyone awaits it.
// No mocks here on purpose: the leak lives in the real SDK + google-auth-library.

import os from "node:os"
import path from "node:path"

import { AnthropicVertexHandler } from "../anthropic-vertex"

const missingKeyFile = path.join(os.tmpdir(), "tumble-test11-missing-vertex-key-file.json")

const collectUnhandledRejections = async (run: () => Promise<void>): Promise<unknown[]> => {
	const rejections: unknown[] = []
	const onUnhandledRejection = (reason: unknown) => {
		rejections.push(reason)
	}

	process.on("unhandledRejection", onUnhandledRejection)

	try {
		await run()
		// Node reports unhandled rejections after the microtask queue drains.
		await new Promise((resolve) => setTimeout(resolve, 100))
	} finally {
		process.off("unhandledRejection", onUnhandledRejection)
	}

	return rejections
}

describe("AnthropicVertexHandler Google credential lookup", () => {
	it("does not leak an unhandled rejection when the credentials cannot be loaded", async () => {
		const rejections = await collectUnhandledRejections(async () => {
			new AnthropicVertexHandler({
				apiModelId: "claude-sonnet-4@20250514",
				vertexProjectId: "test-project",
				vertexRegion: "us-east5",
				vertexKeyFile: missingKeyFile,
			})
		})

		expect(rejections).toEqual([])
	})

	it("still reports the credential error on the first request", async () => {
		const handler = new AnthropicVertexHandler({
			apiModelId: "claude-sonnet-4@20250514",
			vertexProjectId: "test-project",
			vertexRegion: "us-east5",
			vertexKeyFile: missingKeyFile,
		})

		await expect(handler.completePrompt("hello")).rejects.toThrow(/ENOENT/)
	})
})
