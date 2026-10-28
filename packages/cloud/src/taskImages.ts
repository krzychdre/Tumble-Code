import { realpath, stat } from "node:fs/promises"
import path from "node:path"

/**
 * Images a conversation points to by path (plan: 2026-10-12 cloud web task
 * images). The model writes `![alt](monitoring/chart.png)`; the CLI draws the
 * file from the task's working directory, but the cloud only gets the text.
 * These helpers find such references and the files behind them, so the
 * telemetry client can upload the bytes next to the message.
 */

/** Files over this size are not uploaded; the server refuses them too (413). */
export const MAX_TASK_IMAGE_BYTES = 10 * 1024 * 1024

/** The server refuses a longer `path` field (400). */
const MAX_TARGET_BYTES = 1024

/**
 * `![alt](target)` with an optional `"title"`, the target either bare (1) or
 * in `<...>` (2), where it may hold spaces. This is the CLI's Markdown target
 * syntax (`IMAGE_LINE_RE` in apps/cli) plus the spaces `marked` accepts
 * between angle brackets. The CLI draws an image only on a line of its own;
 * the cloud web renders every reference, so every occurrence counts here.
 */
const IMAGE_REFERENCE_RE = /!\[[^\]]*\]\((?:([^\s<>()]+)|<([^<>\n]+)>)(?:\s+"[^"]*")?\)/g

/**
 * A URL scheme (`http:`, `data:`, `file:`, ...). At least two letters, so a
 * Windows drive (`C:\shots\a.png`) still counts as a local path.
 */
const URL_SCHEME_RE = /^[a-z][\w+.-]+:/i

const MIME_BY_EXTENSION: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
}

/**
 * A target the way the cloud web page asks for it: `marked` percent-encodes
 * the `src` it emits and the page runs `decodeURI` on it, so `a%20b.png` and
 * `<a b.png>` are both `a b.png`. A malformed escape is kept as written.
 */
function decodeTarget(target: string): string {
	try {
		return decodeURI(target)
	} catch {
		return target
	}
}

/**
 * The local targets of the image references in `text`, each once, without the
 * `<...>` and the title and with percent escapes decoded: the `path` the cloud
 * web page looks the image up by. Remote and embedded images (`https:`,
 * `data:`, any other scheme, `//host/...`) are left out.
 */
export function findLocalImageReferences(text: string): string[] {
	if (!text.includes("![")) {
		return []
	}
	const targets = new Set<string>()
	for (const match of text.matchAll(IMAGE_REFERENCE_RE)) {
		const written = (match[1] ?? match[2] ?? "").trim()
		if (!written || URL_SCHEME_RE.test(written) || written.startsWith("//")) {
			continue
		}
		const target = decodeTarget(written)
		if (Buffer.byteLength(target, "utf8") <= MAX_TARGET_BYTES) {
			targets.add(target)
		}
	}
	return [...targets]
}

/** The MIME type of an image file by its extension, or undefined for any other file. */
export function imageMimeType(file: string): string | undefined {
	return MIME_BY_EXTENSION[path.extname(file).toLowerCase()]
}

export interface LocatedTaskImage {
	/** The absolute path of the file. */
	file: string
	mime: string
	size: number
	mtimeMs: number
}

/** True when `child` is `parent` or lies below it. */
function isInside(parent: string, child: string): boolean {
	const relative = path.relative(parent, child)
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

/**
 * The file behind a reference target (as `findLocalImageReferences` returns
 * it, escapes decoded): relative targets are resolved against the task's
 * workspace (as the CLI does), absolute ones are taken as they are.
 *
 * Only a file inside the workspace is uploaded. The target is written by the
 * model, so text it was steered into writing (`![](../../.ssh/x.png)`, an
 * absolute path to a photo, a symbolic link in the repository pointing out of
 * it) must not send the user's other files to the cloud. The check compares
 * real paths, so a link is judged by where it leads.
 *
 * Undefined when the target is not an image file of an accepted type, does
 * not exist, is not a regular file, is over 10 MB, lies outside the workspace,
 * or there is no workspace.
 */
export async function locateTaskImage(
	target: string,
	workspacePath: string | undefined,
): Promise<LocatedTaskImage | undefined> {
	const mime = imageMimeType(target)
	if (!mime || !workspacePath) {
		return undefined
	}
	const file = path.resolve(workspacePath, target)
	try {
		const [realWorkspace, realFile] = await Promise.all([realpath(workspacePath), realpath(file)])
		if (!isInside(realWorkspace, realFile)) {
			return undefined
		}
		const info = await stat(realFile)
		if (!info.isFile() || info.size > MAX_TASK_IMAGE_BYTES) {
			return undefined
		}
		return { file: realFile, mime, size: info.size, mtimeMs: info.mtimeMs }
	} catch {
		return undefined
	}
}
