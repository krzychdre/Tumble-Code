/**
 * Proxy `stream` so string chunks pass through `transform` before they are
 * written; non-string chunks and every other property reach the real stream.
 */
export function wrapStreamWrite<T extends NodeJS.WriteStream>(stream: T, transform: (chunk: string) => string): T {
	const write = (chunk: unknown, ...rest: unknown[]): boolean => {
		const data = typeof chunk === "string" ? transform(chunk) : chunk
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
