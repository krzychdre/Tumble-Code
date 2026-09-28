/**
 * Crash report (UI plan §4): after a crash the CLI names the debug log and,
 * when the run had no --debug, says how to get one. The report is written
 * with process.stderr.write, because while the extension host is alive
 * console.error is routed into the debug log (extension-host.ts
 * setupQuietMode), so a crash reported through console.error never reached
 * the terminal of a run without --debug.
 */

import path from "path"
import os from "os"

import { formatCrashHint, formatCrashReport } from "../crash-report.js"

const logPath = path.join(os.homedir(), ".roo", "cli-debug.log")

describe("formatCrashHint", () => {
	it("without --debug, suggests --debug and names the log it would write", () => {
		const hint = formatCrashHint({ debug: false, logPath })

		expect(hint).toContain("--debug")
		expect(hint).toContain(logPath)
	})

	it("with --debug, points at the log that already holds the details", () => {
		const hint = formatCrashHint({ debug: true, logPath })

		expect(hint).toContain(logPath)
		expect(hint).not.toContain("run again with --debug")
	})
})

describe("formatCrashReport", () => {
	it("names the source, the message and the stack, then the hint, ending with a newline", () => {
		const error = new Error("boom")
		error.stack = "Error: boom\n    at somewhere (file.ts:1:1)"

		const report = formatCrashReport(error, { source: "uncaughtException", debug: false, logPath })

		expect(report).toContain("uncaughtException")
		expect(report).toContain("boom")
		expect(report).toContain("at somewhere (file.ts:1:1)")
		expect(report).toContain("--debug")
		expect(report.endsWith("\n")).toBe(true)
		expect(report.indexOf("boom")).toBeLessThan(report.indexOf("--debug"))
	})

	it("reports a non-Error rejection reason as text", () => {
		const report = formatCrashReport("plain reason", { debug: true, logPath })

		expect(report).toContain("plain reason")
		expect(report).toContain(logPath)
	})
})
