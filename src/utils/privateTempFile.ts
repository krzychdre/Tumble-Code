import { promises as fs } from "fs"
import * as os from "os"
import * as path from "path"

/**
 * Temporary files the extension shows the user (a markdown preview, a task's
 * history as JSON, an image from the chat).
 *
 * The system temp directory is shared and world-writable. A file written there
 * under a guessable name (`roo-preview-<Date.now()>.md`) follows a symlink
 * another local account placed at that name, so the write lands in a file of
 * its choosing, and with the default mode the copied conversation is readable
 * by every account. These files go into a directory made with mkdtemp (an
 * unguessable name, mode 0700, so nobody else can enter it or plant links in
 * it), are created exclusively and are readable by the user only.
 */

let privateDir: Promise<string> | undefined

async function directory(): Promise<string> {
	privateDir ??= fs.mkdtemp(path.join(os.tmpdir(), "tumble-"))
	const dir = await privateDir
	try {
		await fs.access(dir)
		return dir
	} catch {
		// A temp cleaner removed it while the extension ran: make a new one.
		privateDir = fs.mkdtemp(path.join(os.tmpdir(), "tumble-"))
		return privateDir
	}
}

/** Writes `data` to a new file named `name` (made unique) in the private temp directory and returns its path. */
export async function writePrivateTempFile(name: string, data: string | Uint8Array): Promise<string> {
	const dir = await directory()
	const { name: base, ext } = path.parse(path.basename(name))
	for (let attempt = 0; ; attempt++) {
		const filePath = path.join(dir, attempt === 0 ? `${base}${ext}` : `${base}-${attempt}${ext}`)
		try {
			await fs.writeFile(filePath, data, { mode: 0o600, flag: "wx" })
			return filePath
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 100) {
				throw error
			}
		}
	}
}
