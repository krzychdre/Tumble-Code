import { randomUUID } from "crypto"
import * as fs from "fs"
import * as path from "path"

/**
 * Replaces `filePath` with `content` readable by its owner only (0600). The
 * content goes to a new temporary file created with that mode and is renamed
 * over the target, so there is no moment in which the content sits in a file
 * other users can read: not even when the file it replaces was created by an
 * older version readable by all. The parent directory must exist.
 */
export function writePrivateFileSync(filePath: string, content: string): void {
	const temporaryPath = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
	)
	try {
		fs.writeFileSync(temporaryPath, content, { flag: "wx", mode: 0o600 })
		fs.renameSync(temporaryPath, filePath)
	} catch (error) {
		fs.rmSync(temporaryPath, { force: true })
		throw error
	}
}
