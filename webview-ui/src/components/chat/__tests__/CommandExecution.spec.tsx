// pnpm --filter @tumble-code/vscode-webview test src/components/chat/__tests__/CommandExecution.spec.tsx

import React from "react"
import { render, screen, fireEvent, act, within } from "@testing-library/react"

import { CommandExecution } from "../CommandExecution"
import { ReadOnlyRowsContext } from "../rows/ReadOnlyRowsContext"
import { TooltipProvider } from "../../ui/tooltip"

// Mock dependencies
// The component labels its buttons and tooltips through i18next's bare `t`.
// i18next is not initialised under vitest and would return undefined, so
// resolve every key to itself and assert on the keys. With real (truthy)
// tooltip content StandardTooltip renders a Radix Tooltip, which needs a
// TooltipProvider in the tree: every render below goes through one.
// The component reads allowed/denied commands and their setters through
// useExtensionSelector. The tests drive per-test state through
// ExtensionStateWrapper; the mock selector reads the value the wrapper
// publishes (the wrapper renders the real ExtensionStateContext.Provider
// below, but the mocked hook reads the holder instead).
const mockSelectorState = vi.hoisted(() => ({ current: undefined as unknown }))

vi.mock("@src/context/ExtensionStateContext", async () => {
	const actual = await vi.importActual<typeof import("@src/context/ExtensionStateContext")>(
		"@src/context/ExtensionStateContext",
	)
	return {
		...actual,
		useExtensionSelector: (selector: (s: never) => unknown) => selector(mockSelectorState.current as never),
	}
})

vi.mock("i18next", () => ({
	t: (key: string) => key,
}))

import { vscode } from "../../../utils/vscode"

vi.mock("../../../utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("../../common/CodeBlock", () => ({
	default: ({ source }: { source: string }) => <div data-testid="code-block">{source}</div>,
}))

// Mock TerminalOutput
vi.mock("../TerminalOutput", () => ({
	TerminalOutput: ({ content }: { content: string }) => <div data-testid="terminal-output">{content}</div>,
}))

vi.mock("../CommandPatternSelector", () => ({
	CommandPatternSelector: ({ patterns, onAllowPatternChange, onDenyPatternChange }: any) => (
		<div data-testid="command-pattern-selector">
			{patterns.map((pattern: any, index: number) => (
				<span key={index}>{pattern.pattern}</span>
			))}
			<button onClick={() => onAllowPatternChange(patterns[0]?.pattern)}>Allow</button>
			<button onClick={() => onDenyPatternChange(patterns[0]?.pattern)}>Deny</button>
		</div>
	),
}))

// Mock ExtensionStateContext
const mockExtensionState = {
	allowedCommands: ["npm"],
	deniedCommands: ["rm"],
	setAllowedCommands: vi.fn(),
	setDeniedCommands: vi.fn(),
}

const ExtensionStateWrapper = ({ children }: { children: React.ReactNode }) => (
	<TooltipProvider>{children}</TooltipProvider>
)

// The whole body (command block, output, pattern selector) is only mounted when
// the parent marks the row as expanded, so every test that asserts on that body
// passes isExpanded={true} explicitly.

describe("CommandExecution", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockSelectorState.current = mockExtensionState
	})

	const renderExpanded = (text: string) =>
		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text={text} isExpanded={true} />
			</ExtensionStateWrapper>,
		)

	it.each([
		["a command without output", "npm install", "npm install", null],
		[
			"a command with output",
			"npm install\nOutput:\nInstalling packages...",
			"npm install",
			"Installing packages...",
		],
	])("shows %s", (_name, text, command, output) => {
		renderExpanded(text)

		expect(screen.getByTestId("code-block")).toHaveTextContent(command)
		expect(screen.queryByTestId("terminal-output")?.textContent?.trim() ?? null).toBe(output)
	})

	it("offers each command of a chain to the pattern selector", () => {
		renderExpanded("npm install && npm test")

		const selector = screen.getByTestId("command-pattern-selector")
		expect(within(selector).getAllByText("npm install").length).toBeGreaterThan(0)
		expect(within(selector).getAllByText("npm test").length).toBeGreaterThan(0)
	})

	it.each([
		["an empty command", ""],
		["a blank command", "   "],
	])("offers no patterns for %s", (_name, text) => {
		renderExpanded(text)

		expect(screen.queryByTestId("command-pattern-selector")).not.toBeInTheDocument()
	})

	// [name, allowed, denied, command, button, new allowed, new denied]
	it.each([
		["allows a new command", ["npm"], ["rm"], "git push", "Allow", ["npm", "git push"], ["rm"]],
		["un-allows an allowed command", ["npm test"], ["rm"], "npm test", "Allow", [], ["rm"]],
		[
			"moves a denied command to allowed",
			["npm"],
			["rm file.txt"],
			"rm file.txt",
			"Allow",
			["npm", "rm file.txt"],
			[],
		],
		["denies a new command", ["npm"], ["rm"], "docker run", "Deny", ["npm"], ["rm", "docker run"]],
		["un-denies a denied command", ["npm"], ["rm -rf"], "rm -rf", "Deny", ["npm"], []],
		["moves an allowed command to denied", ["git push"], [], "git push", "Deny", [], ["git push"]],
		["allows with no lists yet", undefined, undefined, "npm install", "Allow", ["npm install"], []],
	])("%s", (_name, allowedCommands, deniedCommands, text, button, newAllowed, newDenied) => {
		mockSelectorState.current = { ...mockExtensionState, allowedCommands, deniedCommands }
		renderExpanded(text)

		fireEvent.click(screen.getByText(button))

		expect(mockExtensionState.setAllowedCommands).toHaveBeenCalledWith(newAllowed)
		expect(mockExtensionState.setDeniedCommands).toHaveBeenCalledWith(newDenied)
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: { allowedCommands: newAllowed, deniedCommands: newDenied },
		})
	})

	describe("row collapsing", () => {
		// The row must behave like every other collapsible chat row: collapsed
		// until the user opens it, with the expand state owned by the parent
		// (ChatView's expandedRows). Collapsing now hides the whole body, because
		// a command can itself be dozens of lines when a script is passed through
		// a heredoc.
		const commandText = `npm install
Output:
Output here`

		const multiLineCommand = `python3 - <<'EOF'
print("hello")
EOF`

		it("mounts nothing below the header while collapsed", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-collapsed" text={commandText} />
				</ExtensionStateWrapper>,
			)

			// None of the three parts of the body exists in the DOM: no hidden
			// markup, no ANSI conversion work for a row nobody opened.
			expect(screen.queryByTestId("code-block")).not.toBeInTheDocument()
			expect(screen.queryByTestId("terminal-output")).not.toBeInTheDocument()
			expect(screen.queryByTestId("command-pattern-selector")).not.toBeInTheDocument()

			const toggle = screen.getByRole("button", { name: "chat:commandExecution.expandCommand" })
			expect(toggle).toHaveAttribute("aria-expanded", "false")
		})

		it.each([
			["the first line of a multi-line command with an ellipsis", multiLineCommand, "python3 - <<'EOF'…"],
			["a single-line command as it is", "npm install", "npm install"],
		])("previews %s", (_name, text, preview) => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-preview" text={text} />
				</ExtensionStateWrapper>,
			)

			expect(screen.getByText(preview)).toBeInTheDocument()
		})

		it("drops the header preview once the row is expanded", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-preview-expanded" text={multiLineCommand} isExpanded={true} />
				</ExtensionStateWrapper>,
			)

			// The ellipsis is only ever produced by the collapsed preview, never
			// by the command block, which shows the command verbatim.
			expect(screen.queryByText(/…/)).not.toBeInTheDocument()
			expect(screen.getByTestId("code-block")).toHaveTextContent('print("hello")')
		})

		it("mounts the command, the output and the pattern selector when expanded", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-expanded" text={commandText} isExpanded={true} />
				</ExtensionStateWrapper>,
			)

			expect(screen.getByTestId("code-block")).toHaveTextContent("npm install")
			expect(screen.getByTestId("terminal-output")).toHaveTextContent("Output here")
			expect(screen.getByTestId("command-pattern-selector")).toBeInTheDocument()

			const toggle = screen.getByRole("button", { name: "chat:commandExecution.collapseCommand" })
			expect(toggle).toHaveAttribute("aria-expanded", "true")
		})

		it("delegates the toggle to the parent instead of keeping local state", () => {
			const onToggleExpand = vi.fn()

			render(
				<ExtensionStateWrapper>
					<CommandExecution
						executionId="test-toggle"
						text={commandText}
						isExpanded={false}
						onToggleExpand={onToggleExpand}
					/>
				</ExtensionStateWrapper>,
			)

			fireEvent.click(screen.getByRole("button", { name: "chat:commandExecution.expandCommand" }))

			expect(onToggleExpand).toHaveBeenCalledTimes(1)
			// Still collapsed: the parent owns the state and has not flipped it.
			expect(screen.queryByTestId("code-block")).not.toBeInTheDocument()
		})

		it("shows the toggle even when the command produced no output", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-no-output" text="npm install" />
				</ExtensionStateWrapper>,
			)

			// A command always exists, so the chevron is not tied to the output.
			expect(screen.getByRole("button", { name: "chat:commandExecution.expandCommand" })).toBeInTheDocument()
		})
	})

	describe("running status indicator", () => {
		// Simulates an incoming extension message the way the host delivers it:
		// a window MessageEvent, which reaches the component through the extension
		// bus. event.data is an ExtensionMessage with type "commandExecutionStatus"
		// and text holding the JSON-serialised CommandExecutionStatus payload.
		const sendStatusMessage = (executionId: string, payload: Record<string, unknown>) => {
			const data = { type: "commandExecutionStatus", text: JSON.stringify({ executionId, ...payload }) }
			window.dispatchEvent(new MessageEvent("message", { data }))
		}

		it("should show the pulsing dot when status is started", async () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="exec-status-1" text="npm start" />
				</ExtensionStateWrapper>,
			)

			// Dot absent before any status message
			expect(document.querySelector(".animate-pulse")).not.toBeInTheDocument()

			await act(async () => {
				// "started" schema requires executionId, status, command (pid optional)
				sendStatusMessage("exec-status-1", { status: "started", command: "npm start", pid: 1234 })
			})

			// Pulsing dot must appear after the started status arrives
			expect(document.querySelector(".animate-pulse")).toBeInTheDocument()
		})

		// In a subagent's transcript the abort would reach the open task's terminal.
		it("hides the abort button in a read-only transcript", async () => {
			render(
				<ExtensionStateWrapper>
					<ReadOnlyRowsContext.Provider value={true}>
						<CommandExecution executionId="exec-readonly" text="npm start" />
					</ReadOnlyRowsContext.Provider>
					<CommandExecution executionId="exec-writable" text="npm start" />
				</ExtensionStateWrapper>,
			)

			await act(async () => {
				sendStatusMessage("exec-readonly", { status: "started", command: "npm start", pid: 1 })
				sendStatusMessage("exec-writable", { status: "started", command: "npm start", pid: 2 })
			})

			expect(screen.getAllByLabelText("chat:commandExecution.abort")).toHaveLength(1)
			expect(screen.getByText("(PID: 2)")).toBeInTheDocument()
			expect(screen.queryByText("(PID: 1)")).not.toBeInTheDocument()
		})

		it("should not show the pulsing dot for a different executionId", async () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="exec-status-2" text="npm start" />
				</ExtensionStateWrapper>,
			)

			await act(async () => {
				sendStatusMessage("other-id", { status: "started", command: "npm start", pid: 9999 })
			})

			// Dot should remain absent -- wrong execution ID
			expect(document.querySelector(".animate-pulse")).not.toBeInTheDocument()
		})

		it("should remove the pulsing dot when status transitions to exited", async () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="exec-status-3" text="npm start" />
				</ExtensionStateWrapper>,
			)

			await act(async () => {
				sendStatusMessage("exec-status-3", { status: "started", command: "npm start", pid: 1234 })
			})

			// Dot present while running
			expect(document.querySelector(".animate-pulse")).toBeInTheDocument()

			await act(async () => {
				sendStatusMessage("exec-status-3", { status: "exited", exitCode: 0 })
			})

			// Pulsing dot removed after process exits
			expect(document.querySelector(".animate-pulse")).not.toBeInTheDocument()
		})

		it("should show the pulsing dot on mount when the started event was already sent (cache recovery)", async () => {
			// Simulate the race: a prior component received "started" and populated
			// the module-level cache, then unmounted. The new component that mounts
			// (e.g. after an auto-approved command causes a React reconciliation)
			// must recover the status from the cache so the dot appears immediately
			// without waiting for another "started" message.
			const executionId = "exec-cache-recovery"

			const { unmount } = render(
				<ExtensionStateWrapper>
					<CommandExecution executionId={executionId} text="npm start" />
				</ExtensionStateWrapper>,
			)

			// Deliver "started" to the mounted component -- this populates the cache.
			await act(async () => {
				sendStatusMessage(executionId, { status: "started", command: "npm start", pid: 5678 })
			})

			expect(document.querySelector(".animate-pulse")).toBeInTheDocument()

			// Unmount to simulate the component being destroyed.
			unmount()

			// A fresh instance with the same executionId must inherit the cached
			// status and show the dot immediately, without any new message.
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId={executionId} text="npm start" />
				</ExtensionStateWrapper>,
			)

			expect(document.querySelector(".animate-pulse")).toBeInTheDocument()
		})

		it("should not show the pulsing dot on mount after the command has exited (cache cleared)", async () => {
			const executionId = "exec-cache-cleared"

			const { unmount } = render(
				<ExtensionStateWrapper>
					<CommandExecution executionId={executionId} text="npm start" />
				</ExtensionStateWrapper>,
			)

			// Start the command -- populates the cache.
			await act(async () => {
				sendStatusMessage(executionId, { status: "started", command: "npm start", pid: 1234 })
			})

			expect(document.querySelector(".animate-pulse")).toBeInTheDocument()

			// Transition to exited -- cache entry must be deleted.
			await act(async () => {
				sendStatusMessage(executionId, { status: "exited", exitCode: 0 })
			})

			expect(document.querySelector(".animate-pulse")).not.toBeInTheDocument()

			unmount()

			// A fresh instance with the same executionId must NOT show the dot
			// because the cache was cleared when the command exited.
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId={executionId} text="npm start" />
				</ExtensionStateWrapper>,
			)

			expect(document.querySelector(".animate-pulse")).not.toBeInTheDocument()
		})
	})

	describe("multi-line script wrapped in a quoted argument", () => {
		// A wrapper command carrying a multi-line script inside a single quoted
		// argument must be treated as one command. The pattern breakdown must not
		// surface stray fragments from the embedded script lines, which would both
		// clutter the UI and defeat allowlist auto-approval.
		const wrappedCommand = [
			`sh -c 'kubectl exec pod -- python3 -c "`,
			`import urllib.request`,
			`url = \\"http://127.0.0.1:49527/\\"`,
			`print(url)`,
			`"'`,
		].join("\n")

		it("does not surface stray script-line fragments in the pattern selector", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-multiline" text={wrappedCommand} isExpanded={true} />
				</ExtensionStateWrapper>,
			)

			const selector = screen.getByTestId("command-pattern-selector")

			// The wrapper command should be present as a single pattern.
			expect(selector.textContent).toContain("sh")

			// Each script line is rendered as its own <span> only if it was split
			// into a separate command. Assert no span exactly equals a script-line
			// fragment that would indicate erroneous splitting.
			const fragments = Array.from(selector.querySelectorAll("span")).map((s) => s.textContent ?? "")
			expect(fragments).not.toContain("import")
			expect(fragments).not.toContain("import urllib.request")
			expect(fragments).not.toContain("url")
			expect(fragments).not.toContain("print")
		})
	})

	describe("heredoc command in pattern selector", () => {
		// An unterminated heredoc is returned as one opaque token by parseCommand.
		// The pattern selector must show only the leading command word (sh) and
		// must not surface EOF, body-line words, or other heredoc internals.
		it("shows only the leading command for an unterminated heredoc", () => {
			const heredocCommand = "sh << EOF\necho hello"

			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-heredoc" text={heredocCommand} isExpanded={true} />
				</ExtensionStateWrapper>,
			)

			const selector = screen.getByTestId("command-pattern-selector")

			expect(selector.textContent).toContain("sh")

			const fragments = Array.from(selector.querySelectorAll("span")).map((s) => s.textContent ?? "")
			expect(fragments.some((f) => f.includes("EOF"))).toBe(false)
			expect(fragments.some((f) => f.includes("echo"))).toBe(false)
			expect(fragments.some((f) => f.includes("hello"))).toBe(false)
		})
	})
})
