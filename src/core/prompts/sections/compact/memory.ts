/**
 * Memory sections for the compact profile: thin wrappers over the compact
 * variants in `memoryPrompt.ts`, mirroring `sections/memory.ts` for the long
 * prompt. Both close the compact stable head, and both return "" when memory
 * is disabled.
 */

import { loadCompactMemoryIndex, loadCompactMemoryPrompt } from "../../../memory/memoryPrompt"

/** The compact memory instruction (or "" if memory is disabled). */
export async function getCompactMemorySection(cwd: string): Promise<string> {
	return loadCompactMemoryPrompt(cwd)
}

/** The MEMORY.md index in the compact line format, capped at 6,000 characters (or "" if disabled / not yet created). */
export async function getCompactMemoryIndexSection(cwd: string): Promise<string> {
	return loadCompactMemoryIndex(cwd)
}
