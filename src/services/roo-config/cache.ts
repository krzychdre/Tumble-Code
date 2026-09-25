/**
 * Memo for lookups derived from `.roo` directories, keyed by lookup kind and
 * working directory.
 *
 * Two lookups are expensive enough to repeat badly:
 * - "subfolders": the workspace-wide ripgrep scan for nested `.roo`
 *   directories. With subfolder rules on, every system-prompt build used to
 *   run it three times.
 * - "commands": the slash-command list. The chat input asks for it on every
 *   keystroke while the slash menu is open, and each request re-read and
 *   re-parsed every command file.
 *
 * Only directory LISTS and the command list are cached. Rule file contents are
 * still read on every prompt build, and mode-specific directories are derived
 * from the cached list for the mode of that build, so a mid-task mode switch
 * never sees another mode's rules.
 *
 * Entries are dropped by the `.roo` file-system watchers (see watcher.ts) and,
 * as a safety net for hosts whose watchers never fire (the CLI's VS Code
 * shim), after ROO_DIRECTORY_CACHE_TTL_MS.
 */

export type RooDirectoryCacheKind = "subfolders" | "commands"

/** Upper bound on how stale a cached lookup can get when no watcher reports a change. */
export const ROO_DIRECTORY_CACHE_TTL_MS = 30_000

interface Entry {
	value: Promise<unknown>
	expiresAt: number
}

const entries = new Map<string, Entry>()

const keyFor = (kind: RooDirectoryCacheKind, cwd: string) => `${kind}\0${cwd}`

/**
 * Return the cached result for (kind, cwd) or run `compute` once and cache its
 * promise, so concurrent callers share one scan. A rejected lookup is not kept.
 */
export function memoizeRooDirectoryLookup<T>(
	kind: RooDirectoryCacheKind,
	cwd: string,
	compute: () => Promise<T>,
): Promise<T> {
	const key = keyFor(kind, cwd)
	const now = Date.now()
	const hit = entries.get(key)

	if (hit && hit.expiresAt > now) {
		return hit.value as Promise<T>
	}

	const value = compute()
	entries.set(key, { value, expiresAt: now + ROO_DIRECTORY_CACHE_TTL_MS })
	value.catch(() => {
		if (entries.get(key)?.value === value) {
			entries.delete(key)
		}
	})

	return value
}

/** Drop cached lookups of one kind, or of every kind when `kind` is omitted. */
export function invalidateRooDirectoryCache(kind?: RooDirectoryCacheKind): void {
	if (!kind) {
		entries.clear()
		return
	}

	const prefix = `${kind}\0`
	for (const key of [...entries.keys()]) {
		if (key.startsWith(prefix)) {
			entries.delete(key)
		}
	}
}
