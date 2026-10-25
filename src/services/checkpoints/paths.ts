import * as path from "path"

import { getGlobalRooDirectory } from "../roo-config"

/**
 * Checkpoints live under `~/.roo/checkpoints`, not in the extension's globalStorage.
 * VS Code walks the data folder of an extension recursively to show its size on the
 * extension page, and one shadow git repository per task turns that walk into seconds
 * of CPU and gigabytes of renderer memory on every tab switch.
 */
export function getCheckpointsRoot(): string {
	return path.join(getGlobalRooDirectory(), "checkpoints")
}

export function getTaskCheckpointsDir(taskId: string): string {
	return path.join(getCheckpointsRoot(), taskId)
}
