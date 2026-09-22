import type { RooCodeSettings } from "@roo-code/types"

export type PermissionMode = "ask" | "allow"

type AllowPermissionSettings = Pick<
	RooCodeSettings,
	| "autoApprovalEnabled"
	| "alwaysAllowReadOnly"
	| "alwaysAllowReadOnlyOutsideWorkspace"
	| "alwaysAllowWrite"
	| "alwaysAllowWriteOutsideWorkspace"
	| "alwaysAllowWriteProtected"
	| "alwaysAllowMcp"
	| "alwaysAllowModeSwitch"
	| "alwaysAllowSubtasks"
	| "alwaysAllowExecute"
	| "allowedCommands"
>

export type CliPermissionSettings = Partial<AllowPermissionSettings> & Pick<RooCodeSettings, "autoApprovalEnabled">

export const PERMISSIONS_COMMAND_USAGE = [
	"Usage: /permissions <mode>",
	"",
	"Modes:",
	"  ask    Ask before actions",
	"  allow  Allow actions without approval",
].join("\n")

const ASK_PERMISSION_SETTINGS: CliPermissionSettings = {
	autoApprovalEnabled: false,
}

const ALLOW_PERMISSION_SETTINGS: CliPermissionSettings = {
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
}

export type PermissionArgumentResult =
	| { success: true; mode: PermissionMode }
	| { success: true; help: string }
	| { success: false; error: string }

export function getPermissionMode(nonInteractive: boolean): PermissionMode {
	return nonInteractive ? "allow" : "ask"
}

export function getPermissionSettings(mode: PermissionMode): CliPermissionSettings {
	const settings = mode === "allow" ? ALLOW_PERMISSION_SETTINGS : ASK_PERMISSION_SETTINGS

	return settings.allowedCommands ? { ...settings, allowedCommands: [...settings.allowedCommands] } : { ...settings }
}

export function getPermissionsCommandHelp(currentMode: PermissionMode): string {
	return `Current permissions mode: ${currentMode}\n\n${PERMISSIONS_COMMAND_USAGE}`
}

export function resolvePermissionArgument(argument: string, currentMode: PermissionMode): PermissionArgumentResult {
	const tokens = argument.trim().toLowerCase().split(/\s+/).filter(Boolean)

	if (tokens.length === 0) {
		return { success: true, help: getPermissionsCommandHelp(currentMode) }
	}

	if (tokens.length === 1 && (tokens[0] === "ask" || tokens[0] === "allow")) {
		return { success: true, mode: tokens[0] }
	}

	return { success: false, error: PERMISSIONS_COMMAND_USAGE }
}
