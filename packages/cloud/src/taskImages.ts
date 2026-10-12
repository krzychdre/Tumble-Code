import { stat } from "node:fs/promises"
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

/**
 * The file behind a reference target (as `findLocalImageReferences` returns
 * it, escapes decoded): relative targets are resolved against
 * the task's workspace (as the CLI does), absolute ones are taken as they are.
 * Undefined when the target is not an image file of an accepted type, does not
 * exist, is not a regular file, is over 10 MB, or is relative with no
 * workspace to resolve it against.
 */
export async function locateTaskImage(
	target: string,
	workspacePath: string | undefined,
): Promise<LocatedTaskImage | undefined> {
	const mime = imageMimeType(target)
	if (!mime) {
		return undefined
	}
	if (!path.isAbsolute(target) && !workspacePath) {
		return undefined
	}
	const file = workspacePath ? path.resolve(workspacePath, target) : target
	try {
		const info = await stat(file)
		if (!info.isFile() || info.size > MAX_TASK_IMAGE_BYTES) {
			return undefined
		}
		return { file, mime, size: info.size, mtimeMs: info.mtimeMs }
	} catch {
		return undefined
	}
}
