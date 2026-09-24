// cd src && npx vitest run services/mcp/__tests__/mcpSettingsPath.spec.ts

import * as path from "path"

import { readCliRuntimeEnv } from "@roo-code/types"

import { getGlobalMcpSettingsPath } from "../mcpSettingsPath"

vi.mock("@roo-code/types", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@roo-code/types")>()
	return { ...actual, readCliRuntimeEnv: vi.fn(actual.readCliRuntimeEnv) }
})

describe("getGlobalMcpSettingsPath", () => {
	afterEach(() => {
		vi.mocked(readCliRuntimeEnv).mockClear()
	})

	it("reads the CLI override through the typed runtime contract", () => {
		const actual = readCliRuntimeEnv({})
		vi.mocked(readCliRuntimeEnv).mockReturnValueOnce({ ...actual, mcpSettingsPath: "/cli/home/.roo/mcp.json" })

		expect(getGlobalMcpSettingsPath("/storage/settings")).toBe(path.resolve("/cli/home/.roo/mcp.json"))
		expect(readCliRuntimeEnv).toHaveBeenCalledWith(process.env)
	})

	it("falls back to the settings directory when the contract has no override", () => {
		const actual = readCliRuntimeEnv({})
		vi.mocked(readCliRuntimeEnv).mockReturnValueOnce(actual)

		expect(getGlobalMcpSettingsPath("/storage/settings")).toBe(
			path.join("/storage/settings", "mcp_settings.json"),
		)
	})
})
