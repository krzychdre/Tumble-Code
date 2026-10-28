// npx vitest run core/webview/__tests__/openExternal.spec.ts

import * as vscode from "vscode"

import { filesAndCheckpointsHandlers } from "../messageHandlers/filesAndCheckpoints"

describe("the openExternal webview message", () => {
	let opened: string[]

	beforeEach(() => {
		opened = []
		vi.spyOn(vscode.env, "openExternal").mockImplementation(async (uri: vscode.Uri) => {
			opened.push(String((uri as unknown as { path?: string }).path ?? uri))
			return true
		})
	})

	afterEach(() => vi.restoreAllMocks())

	const send = (url: string) =>
		filesAndCheckpointsHandlers.openExternal!({} as never, { type: "openExternal", url } as never)

	it("opens a web link", async () => {
		await send("https://example.com/docs")
		expect(opened).toEqual(["https://example.com/docs"])
	})

	it.each(["command:workbench.action.terminal.new", "file:///etc/passwd", "vscode://x.y/z"])(
		"never hands %j to the system",
		async (url) => {
			await send(url)
			expect(opened).toEqual([])
		},
	)
})
