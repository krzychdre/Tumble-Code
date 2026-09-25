// cd src && ./node_modules/.bin/vitest run services/ripgrep/__tests__/runner.spec.ts

import * as path from "path"

import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("child_process", () => ({
	spawn: vi.fn(),
}))

import * as childProcess from "child_process"

import { runRipgrep, RipgrepError } from "../runner"

import { fakeRg } from "./fake-rg-process"

const RG = path.resolve("/fake/bin/rg")

const mockSpawn = vi.mocked(childProcess.spawn)

describe("runRipgrep", () => {
	beforeEach(() => {
		mockSpawn.mockReset()
	})

	it("returns non-empty stdout lines, joining lines split across chunks", async () => {
		mockSpawn.mockReturnValue(fakeRg({ stdout: ["a.ts\nb.", "ts\r\n\nc.ts"] }) as any)

		const result = await runRipgrep({ rgPath: RG, args: ["--files", "."] })

		expect(mockSpawn).toHaveBeenCalledWith(RG, ["--files", "."])
		expect(result.lines).toEqual(["a.ts", "b.ts", "c.ts"])
		expect(result.exitCode).toBe(0)
		expect(result.limitReached).toBe(false)
		expect(result.timedOut).toBe(false)
	})

	it("treats exit code 1 (no matches) as an empty result, not an error", async () => {
		mockSpawn.mockReturnValue(fakeRg({ exitCode: 1 }) as any)

		const result = await runRipgrep({ rgPath: RG, args: ["-e", "nothing"] })

		expect(result.lines).toEqual([])
		expect(result.exitCode).toBe(1)
	})

	it("keeps results when ripgrep prints warnings on stderr and exits 0", async () => {
		mockSpawn.mockReturnValue(
			fakeRg({ stdout: ["a.ts\n"], stderr: ["rg: ./broken-link: No such file or directory\n"] }) as any,
		)

		const result = await runRipgrep({ rgPath: RG, args: ["--files"] })

		expect(result.lines).toEqual(["a.ts"])
		expect(result.stderr).toContain("broken-link")
	})

	it("keeps partial results when ripgrep exits 2 after producing output", async () => {
		mockSpawn.mockReturnValue(
			fakeRg({ stdout: ["a.ts\n"], stderr: ["rg: ./secret: Permission denied\n"], exitCode: 2 }) as any,
		)

		const result = await runRipgrep({ rgPath: RG, args: ["--files"] })

		expect(result.lines).toEqual(["a.ts"])
		expect(result.exitCode).toBe(2)
	})

	it("rejects with a RipgrepError carrying stderr when ripgrep exits 2 with no output", async () => {
		const stderr = "rg: regex parse error:\n    (?:foo()\n    ^\nerror: unclosed group\n"
		mockSpawn.mockReturnValue(fakeRg({ stderr: [stderr], exitCode: 2 }) as any)

		const error = await runRipgrep({ rgPath: RG, args: ["-e", "foo("] }).catch((e: unknown) => e)

		expect(error).toBeInstanceOf(RipgrepError)
		expect((error as RipgrepError).exitCode).toBe(2)
		expect((error as RipgrepError).stderr).toContain("unclosed group")
		expect((error as RipgrepError).message).toContain("unclosed group")
	})

	it("rejects when the process cannot be spawned", async () => {
		const proc = fakeRg({ hang: true })
		mockSpawn.mockReturnValue(proc as any)
		setImmediate(() => proc.emit("error", new Error("spawn EACCES")))

		await expect(runRipgrep({ rgPath: RG, args: [] })).rejects.toThrow("spawn EACCES")
	})

	it("stops at the line limit, kills ripgrep and reports limitReached", async () => {
		const proc = fakeRg({ stdout: ["1\n2\n3\n4\n5\n"], hang: true })
		mockSpawn.mockReturnValue(proc as any)

		const result = await runRipgrep({ rgPath: RG, args: [], limit: 3 })

		expect(result.lines).toEqual(["1", "2", "3"])
		expect(result.limitReached).toBe(true)
		expect(proc.kill).toHaveBeenCalled()
	})

	it("does not report limitReached when the output has exactly `limit` lines", async () => {
		mockSpawn.mockReturnValue(fakeRg({ stdout: ["1\n2\n3\n"] }) as any)

		const result = await runRipgrep({ rgPath: RG, args: [], limit: 3 })

		expect(result.lines).toEqual(["1", "2", "3"])
		expect(result.limitReached).toBe(false)
	})

	it("kills a hanging ripgrep after the timeout and returns partial results", async () => {
		const proc = fakeRg({ stdout: ["a.ts\n"], hang: true })
		mockSpawn.mockReturnValue(proc as any)

		const result = await runRipgrep({ rgPath: RG, args: [], timeoutMs: 50 })

		expect(result.lines).toEqual(["a.ts"])
		expect(result.timedOut).toBe(true)
		expect(proc.kill).toHaveBeenCalled()
	})

	it("kills ripgrep when the abort signal fires and returns partial results", async () => {
		const proc = fakeRg({ stdout: ["a.ts\n"], hang: true })
		mockSpawn.mockReturnValue(proc as any)
		const controller = new AbortController()
		setTimeout(() => controller.abort(), 20)

		const result = await runRipgrep({ rgPath: RG, args: [], signal: controller.signal, timeoutMs: 0 })

		expect(result.aborted).toBe(true)
		expect(result.lines).toEqual(["a.ts"])
		expect(proc.kill).toHaveBeenCalled()
	})

	it("does not spawn at all when the signal is already aborted", async () => {
		const controller = new AbortController()
		controller.abort()

		const result = await runRipgrep({ rgPath: RG, args: [], signal: controller.signal })

		expect(result.aborted).toBe(true)
		expect(result.lines).toEqual([])
		expect(mockSpawn).not.toHaveBeenCalled()
	})
})
