import * as os from "os"
import * as path from "path"

import * as vscode from "vscode"
import { logger } from "../../utils/logging"

export class ShellIntegrationManager {
	public static terminalTmpDirs: Map<number, string> = new Map()

	/**
	 * Initialize a temporary directory for ZDOTDIR
	 * @param env The environment variables object to modify
	 * @returns The path to the temporary directory, or undefined when it could not be prepared
	 */
	public static zshInitTmpDir(env: Record<string, string>): string | undefined {
		// Save original ZDOTDIR as ROO_ZDOTDIR
		if (process.env.ZDOTDIR) {
			env.ROO_ZDOTDIR = process.env.ZDOTDIR
		}

		// Made with mkdtemp (unguessable, mode 0700) and filled before zsh can
		// start: zsh sources whatever .zshrc it finds there, and a directory with
		// a guessable name in the shared temp directory, created a moment after
		// its name was handed out, could be another account's.
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fs = require("fs") as typeof import("fs")
		let tmpDir: string | undefined
		try {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roo-zdotdir-"))
			const zshrcPath = path.join(tmpDir, ".zshrc")
			fs.writeFileSync(zshrcPath, this.zshrcContent(), { mode: 0o600, flag: "wx" })
			logger.debug(`[TerminalRegistry] Created ${zshrcPath} for ZDOTDIR`)
			return tmpDir
		} catch (error) {
			logger.error(`[TerminalRegistry] Could not prepare a ZDOTDIR: ${error}`)
			if (tmpDir) {
				fs.rmSync(tmpDir, { recursive: true, force: true })
			}
			return undefined
		}
	}

	/** The .zshrc that loads the shell integration, then the user's own startup files. */
	private static zshrcContent(): string {
		const shellIntegrationPath = this.getShellIntegrationPath("zsh")
		return `
	source "${shellIntegrationPath}"
	ZDOTDIR=\${ROO_ZDOTDIR:-$HOME}
	unset ROO_ZDOTDIR
	[ -f "$ZDOTDIR/.zshenv" ] && source "$ZDOTDIR/.zshenv"
	[ -f "$ZDOTDIR/.zprofile" ] && source "$ZDOTDIR/.zprofile"
	[ -f "$ZDOTDIR/.zshrc" ] && source "$ZDOTDIR/.zshrc"
	[ -f "$ZDOTDIR/.zlogin" ] && source "$ZDOTDIR/.zlogin"
	[ "$ZDOTDIR" = "$HOME" ] && unset ZDOTDIR
	`
	}

	/**
	 * Clean up a temporary directory used for ZDOTDIR
	 */
	public static zshCleanupTmpDir(terminalId: number): boolean {
		const tmpDir = this.terminalTmpDirs.get(terminalId)

		if (!tmpDir) {
			return false
		}

		const logPrefix = `[TerminalRegistry] Cleaning up temporary directory for terminal ${terminalId}`
		logger.debug(`${logPrefix}: ${tmpDir}`)

		try {
			// Use fs to remove the directory and its contents. Kept as a lazy
			// require so a test environment without the real fs never loads it.
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const fs = require("fs") as typeof import("fs")

			// Remove .zshrc file
			const zshrcPath = path.join(tmpDir, ".zshrc")
			if (fs.existsSync(zshrcPath)) {
				logger.debug(`${logPrefix}: Removing .zshrc file at ${zshrcPath}`)
				fs.unlinkSync(zshrcPath)
			}

			// Remove the directory
			if (fs.existsSync(tmpDir)) {
				logger.debug(`${logPrefix}: Removing directory at ${tmpDir}`)
				fs.rmdirSync(tmpDir)
			}

			// Remove it from the map
			this.terminalTmpDirs.delete(terminalId)
			logger.debug(`${logPrefix}: Removed terminal ${terminalId} from temporary directory map`)

			return true
		} catch (error: unknown) {
			logger.error(
				`[TerminalRegistry] Error cleaning up temporary directory ${tmpDir}: ${error instanceof Error ? error.message : String(error)}`,
			)

			return false
		}
	}

	public static clear() {
		this.terminalTmpDirs.forEach((_, terminalId) => this.zshCleanupTmpDir(terminalId))
		this.terminalTmpDirs.clear()
	}

	/**
	 * Gets the path to the shell integration script for a given shell type
	 * @param shell The shell type
	 * @returns The path to the shell integration script
	 */
	private static getShellIntegrationPath(shell: "bash" | "pwsh" | "zsh" | "fish"): string {
		let filename: string

		switch (shell) {
			case "bash":
				filename = "shellIntegration-bash.sh"
				break
			case "pwsh":
				filename = "shellIntegration.ps1"
				break
			case "zsh":
				filename = "shellIntegration-rc.zsh"
				break
			case "fish":
				filename = "shellIntegration.fish"
				break
			default:
				throw new Error(`Invalid shell type: ${shell}`)
		}

		// This is the same path used by the CLI command
		return path.join(
			vscode.env.appRoot,
			"out",
			"vs",
			"workbench",
			"contrib",
			"terminal",
			"common",
			"scripts",
			filename,
		)
	}
}
