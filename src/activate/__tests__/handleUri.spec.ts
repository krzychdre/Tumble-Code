// npx vitest run activate/__tests__/handleUri.spec.ts

import type * as vscode from "vscode"

const { handleAuthCallback } = vi.hoisted(() => ({ handleAuthCallback: vi.fn().mockResolvedValue(undefined) }))

vi.mock("vscode", () => ({}))

vi.mock("@tumble-code/cloud", () => ({
	CloudService: {
		get instance() {
			return { handleAuthCallback }
		},
	},
}))

vi.mock("../../core/webview/ClineProvider", () => ({
	ClineProvider: {
		getVisibleInstance: vi.fn().mockReturnValue({}),
	},
}))

import { handleUri } from "../handleUri"
import { startCloudInBackground } from "../../extension/cloudStartup"

const clerkCallback = {
	path: "/auth/clerk/callback",
	query: "code=abc&state=xyz&organizationId=null",
} as unknown as vscode.Uri

describe("handleUri: Clerk sign-in callback (P9)", () => {
	beforeEach(() => {
		handleAuthCallback.mockClear()
	})

	it("waits for a cloud start still running in the background before handing over the callback", async () => {
		let finishStart: () => void = () => {}
		const done = startCloudInBackground(
			() =>
				new Promise<void>((resolve) => {
					finishStart = resolve
				}),
			vi.fn(),
		)

		const handling = handleUri(clerkCallback)
		await new Promise((resolve) => setImmediate(resolve))
		expect(handleAuthCallback).not.toHaveBeenCalled()

		finishStart()
		await done
		await handling

		expect(handleAuthCallback).toHaveBeenCalledWith("abc", "xyz", null)
	})

	it("hands the callback over at once when the cloud start has settled", async () => {
		await startCloudInBackground(() => Promise.resolve(), vi.fn())

		await handleUri(clerkCallback)

		expect(handleAuthCallback).toHaveBeenCalledTimes(1)
	})
})
