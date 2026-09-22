/**
 * Cursor Next Line (`CSI E`): move down one row and to column 1, WITHOUT
 * scrolling. On the bottom row of the screen it does nothing at all.
 */
const CURSOR_NEXT_LINE = "\x1b[E"

/** Carriage return + line feed: the same move, except that it scrolls on the bottom row. */
const NEWLINE = "\r\n"

/**
 * Wrap `stream` so every Cursor Next Line ink writes becomes `\r\n`
 * (plan: 2026-09-22 cli incremental render ghost rows).
 *
 * Ink's incremental renderer (`incrementalRendering: true`, which the TUI uses
 * so the tail does not blink on every spinner tick) moves back to the top of
 * the previous frame, then writes each changed row followed by `\n` and skips
 * each unchanged row with `CSI E`. Its bookkeeping assumes both moves land one
 * row lower. They do, except on the bottom row of the screen: `\n` scrolls
 * there, `CSI E` does not. When a frame grows at the bottom of the window and a
 * row that did not change (typically an empty spacer row) falls below the
 * bottom edge, the skip is swallowed, the rest of the frame is written one row
 * too high, and from then on every frame starts higher than ink thinks. The
 * rows ink no longer reaches stay on the screen: the stacked copies of the
 * footer and the spinner. Ink 7.1 still skips rows this way.
 *
 * `\r\n` is exactly the move ink's line count describes everywhere on the
 * screen, so replacing the sequence fixes the bottom row and changes nothing
 * elsewhere. Only string chunks are rewritten; ink never writes buffers.
 */
export function createScrollSafeStdout<T extends NodeJS.WriteStream>(stream: T): T {
	const write = (chunk: unknown, ...rest: unknown[]): boolean => {
		const data = typeof chunk === "string" ? chunk.replaceAll(CURSOR_NEXT_LINE, NEWLINE) : chunk
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
