import * as path from "path"
import type * as FsPromises from "fs/promises"

import { vi } from "vitest"

/** The files a spec's mocked `fs/promises` holds, keyed by resolved path. */
export interface MemoryFiles {
	get(filePath: string): string | undefined
	set(filePath: string, content: string): void
	has(filePath: string): boolean
	delete(filePath: string): void
	/** Every path that holds a file now, temporary files included. */
	paths(): string[]
}

function errnoError(code: string, syscall: string, filePath: string): NodeJS.ErrnoException {
	return Object.assign(new Error(`${code}: ${syscall} '${filePath}'`), { code, syscall, path: filePath })
}

/**
 * Backs the file side of a mocked `fs/promises` with an in-memory map: writeFile, readFile, rename, open
 * (sync and close), chmod, unlink and stat of a file all see the same files. A spec can then assert what
 * ends up under a path, whether the code wrote it directly or through writeFileAtomic (temporary file,
 * sync, rename). Directory calls (mkdir, readdir, rm, stat of a directory) stay with the spec's own mocks:
 * stat of a path that holds no file falls through to the implementation the spec gave before this call.
 *
 * The module must be mocked with `vi.fn()` members for every function named above.
 */
export function useMemoryFiles(fs: typeof FsPromises): MemoryFiles {
	const files = new Map<string, string>()
	const key = (filePath: unknown) => path.resolve(String(filePath))

	vi.mocked(fs.writeFile).mockImplementation(async (filePath, data, options) => {
		const flag = typeof options === "object" && options !== null ? options.flag : undefined
		if (flag === "wx" && files.has(key(filePath))) {
			throw errnoError("EEXIST", "open", String(filePath))
		}
		files.set(key(filePath), typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8"))
	})

	vi.mocked(fs.readFile).mockImplementation((async (filePath: unknown) => {
		const content = files.get(key(filePath))
		if (content === undefined) {
			throw errnoError("ENOENT", "open", String(filePath))
		}
		return content
	}) as typeof fs.readFile)

	vi.mocked(fs.rename).mockImplementation(async (source, destination) => {
		const content = files.get(key(source))
		if (content === undefined) {
			throw errnoError("ENOENT", "rename", String(source))
		}
		files.delete(key(source))
		files.set(key(destination), content)
	})

	vi.mocked(fs.open).mockImplementation((async (filePath: unknown) => {
		if (!files.has(key(filePath))) {
			throw errnoError("ENOENT", "open", String(filePath))
		}
		return { sync: async () => {}, close: async () => {} }
	}) as typeof fs.open)

	vi.mocked(fs.chmod).mockImplementation(async (filePath) => {
		if (!files.has(key(filePath))) {
			throw errnoError("ENOENT", "chmod", String(filePath))
		}
	})

	vi.mocked(fs.unlink).mockImplementation(async (filePath) => {
		if (!files.delete(key(filePath))) {
			throw errnoError("ENOENT", "unlink", String(filePath))
		}
	})

	const directoryStat = vi.mocked(fs.stat).getMockImplementation()
	vi.mocked(fs.stat).mockImplementation((async (filePath: unknown, ...rest: unknown[]) => {
		if (files.has(key(filePath))) {
			return { isFile: () => true, isDirectory: () => false, mode: 0o100644 }
		}
		if (directoryStat) {
			return (directoryStat as (...args: unknown[]) => unknown)(filePath, ...rest)
		}
		throw errnoError("ENOENT", "stat", String(filePath))
	}) as typeof fs.stat)

	return {
		get: (filePath) => files.get(key(filePath)),
		set: (filePath, content) => void files.set(key(filePath), content),
		has: (filePath) => files.has(key(filePath)),
		delete: (filePath) => void files.delete(key(filePath)),
		paths: () => [...files.keys()],
	}
}
