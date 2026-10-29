import { createHash } from "crypto"
import * as fs from "fs/promises"
import * as path from "path"

import * as vscode from "vscode"

import { t } from "../../i18n"
import { getRooDirectoriesForCwd } from "../../services/roo-config"
import { logger } from "../../utils/logging"

/**
 * Consent for the custom tools of a project (`<workspace>/.roo/tools`).
 *
 * Custom tools are TypeScript or JavaScript files the extension bundles and
 * imports into its own process: loading one runs it with the user's
 * privileges, before any tool call and its approval. A project folder comes
 * with the repository, so a user who turned custom tools on for their own
 * `~/.roo/tools` must not run a cloned repository's tools unasked. The
 * project folder is loaded only once the user agreed to its exact content;
 * any change (a pull, the agent writing a file) asks again. A refusal holds
 * for this content until the window is reloaded, and a workspace the editor
 * does not trust (Restricted Mode) loads none.
 */

export interface TrustStore {
	get<T>(key: string): T | undefined
	update(key: string, value: unknown): Thenable<void>
}

export interface ProjectToolTrustDeps {
	store: TrustStore | undefined
	isWorkspaceTrusted: () => boolean
	/** Asks whether to run the files of `toolDir`; true to run them. */
	confirm: (toolDir: string, files: string[]) => Promise<boolean>
}

export const TRUSTED_PROJECT_TOOLS_KEY = "trustedProjectToolDirectories"
const MAX_TRUSTED = 200
const MAX_FILES = 1000

const declined = new Set<string>()
let queue: Promise<unknown> = Promise.resolve()

/** Every file under `dir` (node_modules left out), relative, sorted. */
async function listFiles(dir: string, prefix = ""): Promise<string[]> {
	const entries = await fs.readdir(path.join(dir, prefix), { withFileTypes: true }).catch(() => [])
	const files: string[] = []
	for (const entry of entries) {
		const relative = path.join(prefix, entry.name)
		if (entry.isDirectory() && entry.name !== "node_modules") {
			files.push(...(await listFiles(dir, relative)))
		} else if (entry.isFile()) {
			files.push(relative)
		}
		if (files.length > MAX_FILES) {
			break
		}
	}
	return files.sort()
}

/** The fingerprint of the folder's content: every file's path and bytes. */
export async function toolDirectoryFingerprint(toolDir: string): Promise<{ fingerprint: string; files: string[] }> {
	const files = await listFiles(toolDir)
	const hash = createHash("sha256").update(path.resolve(toolDir))
	for (const file of files.slice(0, MAX_FILES)) {
		hash.update("\0").update(file).update("\0")
		hash.update(await fs.readFile(path.join(toolDir, file)).catch(() => Buffer.alloc(0)))
	}
	return { fingerprint: hash.digest("hex"), files }
}

async function decide(toolDir: string, deps: ProjectToolTrustDeps): Promise<boolean> {
	const { fingerprint, files } = await toolDirectoryFingerprint(toolDir)
	const toolFiles = files.filter((file) => !file.includes(path.sep) && /\.(ts|js)$/.test(file))
	if (toolFiles.length === 0) {
		return false
	}
	const trusted = deps.store?.get<string[]>(TRUSTED_PROJECT_TOOLS_KEY) ?? []
	if (files.length <= MAX_FILES && trusted.includes(fingerprint)) {
		return true
	}
	if (declined.has(fingerprint) || !deps.isWorkspaceTrusted()) {
		return false
	}
	if (!(await deps.confirm(toolDir, toolFiles))) {
		declined.add(fingerprint)
		return false
	}
	if (files.length <= MAX_FILES) {
		const next = [...trusted.filter((entry) => entry !== fingerprint), fingerprint].slice(-MAX_TRUSTED)
		await deps.store?.update(TRUSTED_PROJECT_TOOLS_KEY, next)
	}
	return true
}

/** Whether the project tool folder may be loaded now (asks when its content is new). */
export function mayLoadProjectTools(toolDir: string, deps: ProjectToolTrustDeps): Promise<boolean> {
	const run = queue.then(() => decide(toolDir, deps))
	queue = run.catch(() => undefined)
	return run
}

async function confirmInDialog(toolDir: string, files: string[]): Promise<boolean> {
	const run = t("tools:customTools.trust.run")
	const answer = await vscode.window.showWarningMessage(
		t("tools:customTools.trust.question", { path: toolDir }),
		{ modal: true, detail: files.join("\n") },
		run,
	)
	return answer === run
}

/**
 * The custom tool folders to load for `cwd`: always the user's own
 * (`~/.roo/tools`), the project's only with consent.
 */
export async function customToolDirectories(cwd: string, context: vscode.ExtensionContext): Promise<string[]> {
	const [globalDir, projectDir] = getRooDirectoriesForCwd(cwd).map((dir) => path.join(dir, "tools"))
	const directories = [globalDir!]
	if (projectDir && projectDir !== globalDir) {
		const allowed = await mayLoadProjectTools(projectDir, {
			store: context.globalState,
			isWorkspaceTrusted: () => vscode.workspace.isTrusted !== false,
			confirm: confirmInDialog,
		})
		if (allowed) {
			directories.push(projectDir)
		} else {
			logger.info(`[customTools] Not loading the project's tools in ${projectDir}: not agreed to`)
		}
	}
	return directories
}
