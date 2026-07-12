import { DiagnosticsCollector } from "../DiagnosticsCollector"
import * as vscode from "vscode"
import delay from "delay"

// Mock delay
vi.mock("delay", () => ({
	default: vi.fn().mockResolvedValue(undefined),
}))

// Mock vscode
vi.mock("vscode", () => ({
	workspace: {},
	languages: {
		getDiagnostics: vi.fn(() => []),
	},
	DiagnosticSeverity: {
		Error: 0,
		Warning: 1,
		Information: 2,
		Hint: 3,
	},
	Uri: {
		file: vi.fn((path) => ({ fsPath: path })),
	},
}))

describe("DiagnosticsCollector", () => {
	let collector: DiagnosticsCollector
	const mockCwd = "/mock/cwd"
	let mockTask: any

	beforeEach(() => {
		vi.clearAllMocks()
		// Reset getDiagnostics to return empty array by default
		vi.mocked(vscode.languages.getDiagnostics).mockReturnValue([])
		mockTask = {
			providerRef: {
				deref: vi.fn().mockReturnValue({
					getState: vi.fn().mockResolvedValue({
						includeDiagnosticMessages: true,
						maxDiagnosticMessages: 50,
					}),
				}),
			},
		}
		collector = new DiagnosticsCollector(mockCwd, mockTask)
	})

	describe("capturePreDiagnostics", () => {
		it("returns the current VS Code diagnostics snapshot", () => {
			const mockDiags: any = [
				[vscode.Uri.file("/test/file.ts"), [{ message: "error", severity: 0, range: {} } as any]],
			]
			vi.mocked(vscode.languages.getDiagnostics).mockReturnValue(mockDiags)

			const result = collector.capturePreDiagnostics()

			expect(vscode.languages.getDiagnostics).toHaveBeenCalledOnce()
			expect(result).toBe(mockDiags)
		})
	})

	describe("collectPostSaveDiagnostics", () => {
		it("returns empty string when diagnostics are disabled", async () => {
			const result = await collector.collectPostSaveDiagnostics([], false, 1000)

			expect(result).toBe("")
			expect(delay).not.toHaveBeenCalled()
		})

		it("calls delay with safe minimum when enabled", async () => {
			const mockDelay = vi.mocked(delay)
			mockDelay.mockClear()

			await collector.collectPostSaveDiagnostics([], true, 3000)

			expect(mockDelay).toHaveBeenCalledWith(3000)
		})

		it("clamps negative delay to zero", async () => {
			const mockDelay = vi.mocked(delay)
			mockDelay.mockClear()

			await collector.collectPostSaveDiagnostics([], true, -500)

			expect(mockDelay).toHaveBeenCalledWith(0)
		})

		it("returns empty string when no new diagnostics are found", async () => {
			vi.mocked(vscode.languages.getDiagnostics).mockReturnValue([])

			const result = await collector.collectPostSaveDiagnostics([], true, 1000)

			expect(result).toBe("")
		})

		it("handles undefined preDiagnostics gracefully", async () => {
			vi.mocked(vscode.languages.getDiagnostics).mockReturnValue([])

			const result = await collector.collectPostSaveDiagnostics(undefined, true, 1000)

			expect(result).toBe("")
		})
	})
})
