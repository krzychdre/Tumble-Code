import os from "os"
import path from "path"

import { getDefaultMcpSettingsPath, resolveMcpSettingsPath } from "../mcp-settings.js"

describe("MCP settings path", () => {
	const rooDir = path.join(os.homedir(), ".roo")

	it("defaults to ~/.roo/mcp.json, next to cli-settings.json", () => {
		expect(getDefaultMcpSettingsPath()).toBe(path.join(rooDir, "mcp.json"))
		expect(resolveMcpSettingsPath(undefined)).toBe(path.join(rooDir, "mcp.json"))
	})

	it("treats an empty or blank setting as unset", () => {
		expect(resolveMcpSettingsPath("")).toBe(path.join(rooDir, "mcp.json"))
		expect(resolveMcpSettingsPath("   ")).toBe(path.join(rooDir, "mcp.json"))
	})

	it("expands a leading ~ to the home directory", () => {
		expect(
			resolveMcpSettingsPath("~/.config/Code/User/globalStorage/qub-it.tumble-code/settings/mcp_settings.json"),
		).toBe(path.join(os.homedir(), ".config/Code/User/globalStorage/qub-it.tumble-code/settings/mcp_settings.json"))
	})

	it("keeps an absolute path", () => {
		const absolute = path.resolve("/etc/tumble/mcp.json")
		expect(resolveMcpSettingsPath(absolute)).toBe(absolute)
	})

	it("takes a relative path from ~/.roo", () => {
		expect(resolveMcpSettingsPath("servers/mcp.json")).toBe(path.join(rooDir, "servers", "mcp.json"))
	})

	it("does not expand ~ in the middle of a name", () => {
		expect(resolveMcpSettingsPath("~backup/mcp.json")).toBe(path.join(rooDir, "~backup", "mcp.json"))
	})
})
