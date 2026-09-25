import { useEffect, useRef } from "react"

type VoidFn = () => void

function sameDeps(a: readonly unknown[], b: readonly unknown[]) {
	return a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
}

/**
 * Runs `effect` after `delay` ms whenever any of the `deps` change (compared with Object.is, like a
 * dependency array), but cancels/re-schedules if they change again before the delay. The call always
 * uses the latest `effect`.
 *
 * The deps are compared by hand in an effect without a dependency array, because a caller-sized list
 * cannot be written as a literal dependency array: spreading it (`[delay, ...deps]`) needs an
 * eslint-disable comment, and the React Compiler skips any function that disables a react-hooks rule.
 */
export function useDebounceEffect(effect: VoidFn, delay: number, deps: any[]) {
	const callbackRef = useRef<VoidFn>(effect)
	const timeoutRef = useRef<NodeJS.Timeout | null>(null)
	// The deps the pending (or last) call was scheduled for; null means "nothing scheduled yet".
	const scheduledForRef = useRef<unknown[] | null>(null)

	// Keep callbackRef current
	useEffect(() => {
		callbackRef.current = effect
	}, [effect])

	// Runs after every render; schedules only when `delay` or one of the `deps` changed.
	useEffect(() => {
		const next = [delay, ...deps]
		if (scheduledForRef.current && sameDeps(scheduledForRef.current, next)) {
			return
		}
		scheduledForRef.current = next

		// Clear any queued call
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current)
		}

		// Schedule a new call
		timeoutRef.current = setTimeout(() => {
			// always call the *latest* version of effect
			callbackRef.current()
		}, delay)
	})

	// Cancel on unmount. Forgetting the scheduled deps lets a remount (StrictMode mounts effects twice)
	// schedule again.
	useEffect(
		() => () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
			}
			scheduledForRef.current = null
		},
		[],
	)
}
