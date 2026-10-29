// cd src && npx vitest run integrations/terminal/__tests__/ShellIntegrationManager.zdotdir.spec.ts

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import * as vscode from "vscode"

import { ShellIntegrationManager } from "../ShellIntegrationManager"

describe("ShellIntegrationManager.zshInitTmpDir", () => {
	const made: string[] = []

	beforeEach(() => {
		// Where VS Code keeps its shell integration scripts.
		Object.assign(vscode.env, { appRoot: "/opt/vscode/resources/app" })
	})

	afterEach(() => {
		made.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }))
	})

	it("has the directory and its .zshrc in place, private, when it returns", () => {
		const env: Record<string, string> = {}
		const dir = ShellIntegrationManager.zshInitTmpDir(env)!
		made.push(dir)

		expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()))
		expect(path.basename(dir)).toMatch(/^roo-zdotdir-.{6}$/)
		const zshrc = fs.readFileSync(path.join(dir, ".zshrc"), "utf8")
		expect(zshrc).toContain("ZDOTDIR=${ROO_ZDOTDIR:-$HOME}")
		expect(zshrc).toContain(`source "${path.join("/opt/vscode/resources/app", "out")}`)
		if (process.platform !== "win32") {
			expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
			expect(fs.statSync(path.join(dir, ".zshrc")).mode & 0o777).toBe(0o600)
		}
	})

	it("gives every terminal its own directory", () => {
		const first = ShellIntegrationManager.zshInitTmpDir({})!
		const second = ShellIntegrationManager.zshInitTmpDir({})!
		made.push(first, second)
		expect(first).not.toBe(second)
	})

	it("answers undefined, so no ZDOTDIR is set, when the .zshrc cannot be written", () => {
		Object.assign(vscode.env, { appRoot: undefined })
		expect(ShellIntegrationManager.zshInitTmpDir({})).toBeUndefined()
	})
})
