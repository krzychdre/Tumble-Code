/**
 * Blocks the current thread for `ms` milliseconds without burning CPU.
 *
 * The build helpers are synchronous (copyPaths runs inside esbuild plugin
 * hooks that expect a synchronous return), so an async `setTimeout` is not an
 * option. `Atomics.wait` on a private buffer that nobody ever notifies parks
 * the thread in the kernel until the timeout expires, instead of spinning a
 * `while (Date.now() - start < ms)` loop at 100% of a core.
 */
export function sleepSync(ms: number): void {
	if (!(ms > 0)) {
		return
	}

	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
