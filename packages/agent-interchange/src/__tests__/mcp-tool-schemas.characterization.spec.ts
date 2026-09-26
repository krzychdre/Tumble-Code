import * as fs from "node:fs"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

import { createInterchangeServer } from "../mcp/server.js"
import { isolateHome, makeTempDir } from "./fixtures.js"

/**
 * Pins the JSON schemas the MCP SDK builds from our zod tool arguments (DEP-8,
 * zod 3 to zod 4). The model sees exactly these schemas in tools/list, and the
 * SDK converts zod 3 and zod 4 schemas with different code, so any drift shows
 * up here as a snapshot diff.
 */
describe("agent-interchange tool input schemas (characterization)", () => {
	let workspaceDir: string
	let restoreHome: () => void

	beforeEach(() => {
		restoreHome = isolateHome()
		workspaceDir = makeTempDir("mcp-schema-workspace")
	})

	afterEach(() => {
		restoreHome()
		fs.rmSync(workspaceDir, { recursive: true, force: true })
	})

	it.each([false, true])("advertises stable input schemas (allowCrossWorkspace: %s)", async (allowCrossWorkspace) => {
		const server = createInterchangeServer(workspaceDir, { allowCrossWorkspace })
		const client = new Client({ name: "test", version: "0.0.0" })
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

		try {
			const { tools } = await client.listTools()
			const schemas = Object.fromEntries(
				[...tools].sort((a, b) => a.name.localeCompare(b.name)).map((tool) => [tool.name, tool.inputSchema]),
			)
			const text = JSON.stringify(schemas, null, 2).split(fs.realpathSync.native(workspaceDir)).join("<workspace>")
			expect(text.split(workspaceDir).join("<workspace>")).toMatchSnapshot()
		} finally {
			await Promise.all([client.close(), server.close()])
		}
	})
})
