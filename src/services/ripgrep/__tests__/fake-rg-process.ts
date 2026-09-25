// Test helper shared by the ripgrep, file-search and list-files specs.

import { EventEmitter } from "events"
import { PassThrough } from "stream"

import { vi } from "vitest"

export type FakeRgOptions = {
	stdout?: string[]
	stderr?: string[]
	exitCode?: number
	/** Never exit on its own (only `kill()` ends it). */
	hang?: boolean
}

/** A child process look-alike with real streams, so readline-based code works too. */
export function fakeRg({ stdout = [], stderr = [], exitCode = 0, hang = false }: FakeRgOptions = {}) {
	const proc = new EventEmitter() as EventEmitter & {
		stdout: PassThrough
		stderr: PassThrough
		kill: ReturnType<typeof vi.fn>
	}
	proc.stdout = new PassThrough()
	proc.stderr = new PassThrough()
	let closed = false
	const close = (code: number | null) => {
		if (closed) return
		closed = true
		proc.stdout.end()
		proc.stderr.end()
		setImmediate(() => proc.emit("close", code))
	}
	proc.kill = vi.fn(() => {
		close(null)
		return true
	})
	setImmediate(() => {
		for (const chunk of stderr) proc.stderr.write(chunk)
		for (const chunk of stdout) proc.stdout.write(chunk)
		if (!hang) close(exitCode)
	})
	return proc
}
