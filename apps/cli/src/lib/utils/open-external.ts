import { spawn } from "child_process"

export function openExternal(url: string): Promise<boolean> {
	const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open"
	const args = process.platform === "win32" ? ["/d", "/s", "/c", "start", "", url] : [url]

	return new Promise((resolve) => {
		const child = spawn(command, args, {
			stdio: "ignore",
			detached: process.platform !== "win32",
			windowsHide: true,
		})
		child.once("error", () => resolve(false))
		child.once("spawn", () => {
			child.unref()
			resolve(true)
		})
	})
}
