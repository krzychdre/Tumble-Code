import { useCallback, useLayoutEffect, useRef } from "react"

/**
 * Returns a function whose identity never changes but which always calls the
 * latest `callback`. Use it for callbacks handed to memoized children (chat
 * rows) whose own dependencies change often: a new function identity on every
 * render would make the child's memo fail and re-render it for nothing.
 *
 * The latest callback is stored after render, so the returned function must
 * only be called from event handlers, timers or effects, never during render.
 */
export function useStableCallback<Args extends unknown[], Result>(
	callback: (...args: Args) => Result,
): (...args: Args) => Result {
	const callbackRef = useRef(callback)

	useLayoutEffect(() => {
		callbackRef.current = callback
	})

	return useCallback((...args: Args) => callbackRef.current(...args), [])
}
