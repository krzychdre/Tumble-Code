import { expandImageMarkers } from "../graphics/inlineImages.js"

/**
 * Wrap `stream` so the image markers ink prints in the transcript become the
 * images (plan: 2026-10-12 cli inline images, see `graphics/inlineImages.ts`).
 * Only string chunks are rewritten; ink never writes buffers.
 */
export function createImageStdout<T extends NodeJS.WriteStream>(stream: T): T {
	const write = (chunk: unknown, ...rest: unknown[]): boolean => {
		const data = typeof chunk === "string" ? expandImageMarkers(chunk) : chunk
		return (stream.write as (...args: unknown[]) => boolean)(data, ...rest)
	}

	return new Proxy(stream, {
		get(target, property) {
			if (property === "write") {
				return write
			}
			// Methods must run against the real stream (event emitter state,
			// `columns`/`rows` getters), not against the proxy.
			const value = Reflect.get(target, property, target)
			return typeof value === "function" ? value.bind(target) : value
		},
	})
}
