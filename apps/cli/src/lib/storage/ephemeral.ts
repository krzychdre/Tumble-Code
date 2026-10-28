import path from "path"
import os from "os"
import fs from "fs"

/**
 * A fresh directory for a run's state: mkdtemp gives an unguessable name and
 * mode 0700, so no other account can pre-create it or read what is kept there.
 */
export async function createEphemeralStorageDir(): Promise<string> {
	return fs.promises.mkdtemp(path.join(os.tmpdir(), "roo-cli-"))
}
