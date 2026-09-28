/**
 * `tumble doctor` (UI plan §4): one line per check with pass, warn or fail,
 * and a non-zero exit when any check fails.
 */

import fs from "fs"
import os from "os"
import path from "path"

import {
	checkCloudReachable,
	checkExtensionBundle,
	checkMcpConfig,
	checkNodeVersion,
	checkRipgrep,
	formatDoctorReport,
	ripgrepCandidates,
	runDoctor,
	type DoctorCheckResult,
} from "../doctor.js"

let tempDir: string

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-doctor-test-"))
})

afterEach(() => {
	fs.rmSync(tempDir, { recursive: true, force: true })
})

describe("checkNodeVersion", () => {
	it("passes on Node 22 or newer", () => {
		expect(checkNodeVersion("22.0.0").status).toBe("pass")
		expect(checkNodeVersion("24.1.0").status).toBe("pass")
	})

	it("fails below Node 22 and names the requirement", () => {
		const result = checkNodeVersion("20.11.1")

		expect(result.status).toBe("fail")
		expect(result.detail).toContain("20.11.1")
		expect(result.detail).toContain("22")
	})
})

describe("checkExtensionBundle", () => {
	it("passes when extension.js is in the directory", () => {
		fs.writeFileSync(path.join(tempDir, "extension.js"), "")

		const result = checkExtensionBundle(tempDir)

		expect(result.status).toBe("pass")
		expect(result.detail).toContain(path.join(tempDir, "extension.js"))
	})

	it("fails when extension.js is missing and says how to point at a bundle", () => {
		const result = checkExtensionBundle(tempDir)

		expect(result.status).toBe("fail")
		expect(result.detail).toContain(path.join(tempDir, "extension.js"))
		expect(result.detail).toContain("--extension")
	})
})

describe("checkRipgrep", () => {
	const binName = process.platform === "win32" ? "rg.exe" : "rg"

	it("looks where the extension looks: the override, then the CLI's node_modules", () => {
		const candidates = ripgrepCandidates(tempDir, path.join(tempDir, "custom", binName))

		expect(candidates[0]).toBe(path.join(tempDir, "custom", binName))
		expect(candidates).toContain(path.join(tempDir, "node_modules", "@vscode", "ripgrep", "bin", binName))
		expect(candidates).toContain(
			path.join(tempDir, "node_modules", `@vscode/ripgrep-${process.platform}-${process.arch}`, "bin", binName),
		)
	})

	it("passes with the version of the first binary that exists and runs", async () => {
		const binary = path.join(tempDir, "node_modules", "@vscode", "ripgrep", "bin", binName)
		fs.mkdirSync(path.dirname(binary), { recursive: true })
		fs.writeFileSync(binary, "")
		const runVersion = vi.fn(async () => "ripgrep 14.1.1\nfeatures:+pcre2")

		const result = await checkRipgrep({ cliRoot: tempDir, runVersion })

		expect(runVersion).toHaveBeenCalledWith(binary)
		expect(result.status).toBe("pass")
		expect(result.detail).toContain("ripgrep 14.1.1")
		expect(result.detail).not.toContain("features")
	})

	it("fails when no binary exists", async () => {
		const result = await checkRipgrep({ cliRoot: tempDir, runVersion: async () => "never" })

		expect(result.status).toBe("fail")
		expect(result.detail).toContain("not found")
	})

	it("fails when the binary does not run", async () => {
		const binary = path.join(tempDir, "node_modules", "@vscode", "ripgrep", "bin", binName)
		fs.mkdirSync(path.dirname(binary), { recursive: true })
		fs.writeFileSync(binary, "")

		const result = await checkRipgrep({
			cliRoot: tempDir,
			runVersion: async () => {
				throw new Error("EACCES")
			},
		})

		expect(result.status).toBe("fail")
		expect(result.detail).toContain("EACCES")
	})
})

describe("checkMcpConfig", () => {
	it("passes without a file: no global MCP servers is a valid setup", () => {
		const result = checkMcpConfig(path.join(tempDir, "mcp.json"))

		expect(result.status).toBe("pass")
		expect(result.detail).toContain("no global MCP servers")
	})

	it("passes and counts the servers of a valid file", () => {
		const file = path.join(tempDir, "mcp.json")
		fs.writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: "x" }, b: { url: "http://y" } } }))

		const result = checkMcpConfig(file)

		expect(result.status).toBe("pass")
		expect(result.detail).toContain("2 servers")
	})

	it("fails on a file that is not JSON", () => {
		const file = path.join(tempDir, "mcp.json")
		fs.writeFileSync(file, "{ nope")

		const result = checkMcpConfig(file)

		expect(result.status).toBe("fail")
		expect(result.detail).toContain(file)
	})

	it("fails when mcpServers is not an object", () => {
		const file = path.join(tempDir, "mcp.json")
		fs.writeFileSync(file, JSON.stringify({ mcpServers: [] }))

		expect(checkMcpConfig(file).status).toBe("fail")
	})
})

describe("checkCloudReachable", () => {
	it("passes on any HTTP answer and reports the status", async () => {
		const fetchImpl = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch

		const result = await checkCloudReachable({ url: "https://cloud.example", fetchImpl, timeoutMs: 1000 })

		expect(result.status).toBe("pass")
		expect(result.detail).toContain("https://cloud.example")
		expect(result.detail).toContain("404")
	})

	it("warns (the CLI works offline) when the request fails", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new TypeError("fetch failed")
		}) as unknown as typeof fetch

		const result = await checkCloudReachable({ url: "https://cloud.example", fetchImpl, timeoutMs: 1000 })

		expect(result.status).toBe("warn")
		expect(result.detail).toContain("fetch failed")
	})

	it("gives up after the timeout", async () => {
		const fetchImpl = ((_url: string, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
			})) as unknown as typeof fetch

		const started = Date.now()
		const result = await checkCloudReachable({ url: "https://cloud.example", fetchImpl, timeoutMs: 50 })

		expect(result.status).toBe("warn")
		expect(result.detail).toContain("50 ms")
		expect(Date.now() - started).toBeLessThan(2000)
	})
})

describe("formatDoctorReport", () => {
	const results: DoctorCheckResult[] = [
		{ name: "Node.js", status: "pass", detail: "v22.1.0" },
		{ name: "Cloud", status: "warn", detail: "unreachable" },
		{ name: "ripgrep", status: "fail", detail: "not found" },
	]

	it("prints one labelled line per check and a summary", () => {
		const report = formatDoctorReport(results)
		const lines = report.trimEnd().split("\n")

		expect(
			lines.some((line) => line.includes("[pass]") && line.includes("Node.js") && line.includes("v22.1.0")),
		).toBe(true)
		expect(lines.some((line) => line.includes("[warn]") && line.includes("Cloud"))).toBe(true)
		expect(lines.some((line) => line.includes("[fail]") && line.includes("ripgrep"))).toBe(true)
		expect(lines.at(-1)).toContain("1 failed")
		expect(lines.at(-1)).toContain("1 warning")
	})
})

describe("runDoctor", () => {
	it("returns exit code 1 when a check fails and 0 otherwise", async () => {
		const write = vi.fn()

		expect(
			await runDoctor({
				checks: [
					async () => ({ name: "a", status: "pass", detail: "" }),
					() => ({ name: "b", status: "warn", detail: "" }),
				],
				write,
			}),
		).toBe(0)
		expect(
			await runDoctor({
				checks: [
					() => ({ name: "a", status: "pass", detail: "" }),
					() => ({ name: "c", status: "fail", detail: "" }),
				],
				write,
			}),
		).toBe(1)
		expect(write).toHaveBeenCalled()
	})

	it("turns a check that throws into a failed line instead of crashing", async () => {
		const write = vi.fn()

		const code = await runDoctor({
			checks: [
				() => {
					throw new Error("unexpected")
				},
			],
			write,
		})

		expect(code).toBe(1)
		expect(write.mock.calls.map(([text]) => String(text)).join("")).toContain("unexpected")
	})
})
