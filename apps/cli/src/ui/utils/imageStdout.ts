import { expandImageMarkers } from "../graphics/inlineImages.js"
import { wrapStreamWrite } from "./wrapStreamWrite.js"

/**
 * Wrap `stream` so the image markers ink prints in the transcript become the
 * images (plan: 2026-10-12 cli inline images, see `graphics/inlineImages.ts`).
 * Only string chunks are rewritten; ink never writes buffers.
 */
export function createImageStdout<T extends NodeJS.WriteStream>(stream: T): T {
	return wrapStreamWrite(stream, expandImageMarkers)
}
