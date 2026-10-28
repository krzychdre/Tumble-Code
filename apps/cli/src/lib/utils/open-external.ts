import { spawn } from "child_process"

import { isOpenableExternalUrl } from "@tumble-code/core/browser"

export interface OpenExternalOptions {
	platform?: NodeJS.Platform
	/** Starts the opener; child_process.spawn by default. */
	spawnProcess?: typeof spawn
}

/**
 * The opener for a URL on this platform. Never a shell: on Windows `cmd /c
 * start` parsed the URL as a command line, so an `&` in it ran a second
 * command; rundll32's URL handler takes it as one argument.
 */
function opener(url: string, platform: NodeJS.Platform): { command: string; args: string[] } {
	if (platform === "darwin") {
		return { command: "open", args: [url] }
	}
	if (platform === "win32") {
		return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] }
	}
	return { command: "xdg-open", args: [url] }
}

/** Opens an http, https or mailto URL in the user's browser or mail client; anything else is refused (false). */
export function openExternal(url: string, options: OpenExternalOptions = {}): Promise<boolean> {
	if (!isOpenableExternalUrl(url)) {
		return Promise.resolve(false)
	}
	const platform = options.platform ?? process.platform
	const { command, args } = opener(url, platform)

	return new Promise((resolve) => {
		const child = (options.spawnProcess ?? spawn)(command, args, {
			stdio: "ignore",
			detached: platform !== "win32",
			windowsHide: true,
		})
		child.once("error", () => resolve(false))
		child.once("spawn", () => {
			child.unref()
			resolve(true)
		})
	})
}
