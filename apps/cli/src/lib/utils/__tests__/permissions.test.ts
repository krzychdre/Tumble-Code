import {
	PERMISSIONS_COMMAND_USAGE,
	getPermissionMode,
	getPermissionSettings,
	getPermissionsCommandHelp,
	resolvePermissionArgument,
} from "../permissions.js"

describe("CLI permissions", () => {
	it("maps the startup approval flag to a permission mode", () => {
		expect(getPermissionMode(false)).toBe("ask")
		expect(getPermissionMode(true)).toBe("allow")
	})

	it("uses only the master kill switch for manual approval", () => {
		expect(getPermissionSettings("ask")).toEqual({
			autoApprovalEnabled: false,
		})
	})

	it("builds the complete auto-approval profile", () => {
		expect(getPermissionSettings("allow")).toEqual({
			autoApprovalEnabled: true,
			alwaysAllowReadOnly: true,
			alwaysAllowReadOnlyOutsideWorkspace: true,
			alwaysAllowWrite: true,
			alwaysAllowWriteOutsideWorkspace: true,
			alwaysAllowWriteProtected: true,
			alwaysAllowMcp: true,
			alwaysAllowModeSwitch: true,
			alwaysAllowSubtasks: true,
			alwaysAllowExecute: true,
			allowedCommands: ["*"],
		})
	})

	it("shows the current mode and available options when no explicit mode is supplied", () => {
		expect(resolvePermissionArgument("", "ask")).toEqual({
			success: true,
			help: getPermissionsCommandHelp("ask"),
		})
		expect(resolvePermissionArgument("  ", "allow")).toEqual({
			success: true,
			help: getPermissionsCommandHelp("allow"),
		})
		expect(getPermissionsCommandHelp("ask")).toContain("Current permissions mode: ask")
		expect(PERMISSIONS_COMMAND_USAGE).toContain("ask    Ask before actions")
		expect(PERMISSIONS_COMMAND_USAGE).toContain("allow  Allow actions without approval")
	})

	it("accepts explicit modes case-insensitively", () => {
		expect(resolvePermissionArgument("ask", "allow")).toEqual({ success: true, mode: "ask" })
		expect(resolvePermissionArgument("ALLOW", "ask")).toEqual({ success: true, mode: "allow" })
	})

	it("rejects unknown or extra arguments", () => {
		expect(resolvePermissionArgument("maybe", "ask")).toEqual({
			success: false,
			error: PERMISSIONS_COMMAND_USAGE,
		})
		expect(resolvePermissionArgument("allow now", "ask")).toEqual({
			success: false,
			error: PERMISSIONS_COMMAND_USAGE,
		})
	})

	it("returns fresh command arrays so callers cannot mutate the shared profile", () => {
		const first = getPermissionSettings("allow")
		first.allowedCommands?.push("echo")

		expect(getPermissionSettings("allow").allowedCommands).toEqual(["*"])
	})
})
