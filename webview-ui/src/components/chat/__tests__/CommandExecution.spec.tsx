// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/CommandExecution.spec.tsx

import React from "react"
import { render, screen, fireEvent, act } from "@testing-library/react"

import { CommandExecution } from "../CommandExecution"
import { ExtensionStateContext } from "../../../context/ExtensionStateContext"
import { TooltipProvider } from "../../ui/tooltip"

// Mock dependencies
// The component labels its buttons and tooltips through i18next's bare `t`.
// i18next is not initialised under vitest and would return undefined, so
// resolve every key to itself and assert on the keys. With real (truthy)
// tooltip content StandardTooltip renders a Radix Tooltip, which needs a
// TooltipProvider in the tree: every render below goes through one.
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
	<ExtensionStateContext.Provider value={mockExtensionState as any}>
		<TooltipProvider>{children}</TooltipProvider>
	</ExtensionStateContext.Provider>
)

// The whole body (command block, output, pattern selector) is only mounted when
// the parent marks the row as expanded, so every test that asserts on that body
// passes isExpanded={true} explicitly.

describe("CommandExecution", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should render command without output", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="npm install" isExpanded={true} />
			</ExtensionStateWrapper>,
		)

		expect(screen.getByTestId("code-block")).toHaveTextContent("npm install")
	})

	it("should render command with output", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution
					executionId="test-1"
					text="npm install\nOutput:\nInstalling packages..."
					isExpanded={true}
				/>
			</ExtensionStateWrapper>,
		)

		const codeBlocks = screen.getAllByTestId("code-block")
		expect(codeBlocks[0]).toHaveTextContent("npm install")

		const terminalOutput = screen.getByTestId("terminal-output")
		expect(terminalOutput).toHaveTextContent("Installing packages...")
	})

	it("should render with custom icon and title", () => {
		const icon = <span data-testid="custom-icon">📦</span>
		const title = <span data-testid="custom-title">Installing Dependencies</span>

		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="npm install" icon={icon} title={title} />
			</ExtensionStateWrapper>,
		)

		expect(screen.getByTestId("custom-icon")).toBeInTheDocument()
		expect(screen.getByTestId("custom-title")).toBeInTheDocument()
	})

	it("should show command pattern selector for commands", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="npm install express" isExpanded={true} />
			</ExtensionStateWrapper>,
		)

		expect(screen.getByTestId("command-pattern-selector")).toBeInTheDocument()
		// Check that the command is shown in the pattern selector
		const selector = screen.getByTestId("command-pattern-selector")
		expect(selector).toHaveTextContent("npm install express")
	})

	it("should handle allow command change", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="git push" isExpanded={true} />
			</ExtensionStateWrapper>,
		)

		const allowButton = screen.getByText("Allow")
		fireEvent.click(allowButton)

		expect(mockExtensionState.setAllowedCommands).toHaveBeenCalledWith(["npm", "git push"])
		expect(mockExtensionState.setDeniedCommands).toHaveBeenCalledWith(["rm"])
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: {
				allowedCommands: ["npm", "git push"],
				deniedCommands: ["rm"],
			},
		})
	})

	it("should handle deny command change", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="docker run" isExpanded={true} />
			</ExtensionStateWrapper>,
		)

		const denyButton = screen.getByText("Deny")
		fireEvent.click(denyButton)

		expect(mockExtensionState.setAllowedCommands).toHaveBeenCalledWith(["npm"])
		expect(mockExtensionState.setDeniedCommands).toHaveBeenCalledWith(["rm", "docker run"])
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: {
				allowedCommands: ["npm"],
				deniedCommands: ["rm", "docker run"],
			},
		})
	})

	it("should toggle allowed command", () => {
		// Update the mock state to have "npm test" in allowedCommands
		const stateWithNpmTest = {
			...mockExtensionState,
			allowedCommands: ["npm test"],
			deniedCommands: ["rm"],
		}

		render(
			<ExtensionStateContext.Provider value={stateWithNpmTest as any}>
				<CommandExecution executionId="test-1" text="npm test" isExpanded={true} />
			</ExtensionStateContext.Provider>,
		)

		const allowButton = screen.getByText("Allow")
		fireEvent.click(allowButton)

		// "npm test" is already in allowedCommands, so it should be removed
		expect(stateWithNpmTest.setAllowedCommands).toHaveBeenCalledWith([])
		expect(stateWithNpmTest.setDeniedCommands).toHaveBeenCalledWith(["rm"])
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: {
				allowedCommands: [],
				deniedCommands: ["rm"],
			},
		})
	})

	it("should toggle denied command", () => {
		// Update the mock state to have "rm -rf" in deniedCommands
		const stateWithRmRf = {
			...mockExtensionState,
			allowedCommands: ["npm"],
			deniedCommands: ["rm -rf"],
		}

		render(
			<ExtensionStateContext.Provider value={stateWithRmRf as any}>
				<CommandExecution executionId="test-1" text="rm -rf" isExpanded={true} />
			</ExtensionStateContext.Provider>,
		)

		const denyButton = screen.getByText("Deny")
		fireEvent.click(denyButton)

		// "rm -rf" is already in deniedCommands, so it should be removed
		expect(stateWithRmRf.setAllowedCommands).toHaveBeenCalledWith(["npm"])
		expect(stateWithRmRf.setDeniedCommands).toHaveBeenCalledWith([])
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: {
				allowedCommands: ["npm"],
				deniedCommands: [],
			},
		})
	})

	it("should parse command with Output: separator", () => {
		const commandText = `npm install
Output:
Installing...`

		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text={commandText} isExpanded={true} />
			</ExtensionStateWrapper>,
		)

		const codeBlocks = screen.getAllByTestId("code-block")
		expect(codeBlocks[0]).toHaveTextContent("npm install")
	})

	it("should parse command with output", () => {
		const commandText = `npm install
Output:
Suggested patterns: npm, npm install, npm run`

		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text={commandText} isExpanded={true} />
			</ExtensionStateWrapper>,
		)

		// First check that the command was parsed correctly
		const codeBlocks = screen.getAllByTestId("code-block")
		expect(codeBlocks[0]).toHaveTextContent("npm install")

		const terminalOutput = screen.getByTestId("terminal-output")
		expect(terminalOutput).toHaveTextContent("Suggested patterns: npm, npm install, npm run")

		const selector = screen.getByTestId("command-pattern-selector")
		expect(selector).toBeInTheDocument()
		// Should show the full command in the selector
		expect(selector).toHaveTextContent("npm install")
	})

	it("should handle commands with pipes", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="ls -la | grep test" isExpanded={true} />
			</ExtensionStateWrapper>,
		)

		const selector = screen.getByTestId("command-pattern-selector")
		expect(selector).toBeInTheDocument()
		// Should show one of the individual commands from the pipe
		expect(selector.textContent).toMatch(/ls -la|grep test/)
	})

	it("should handle commands with && operator", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="npm install && npm test" isExpanded={true} />
			</ExtensionStateWrapper>,
		)

		const selector = screen.getByTestId("command-pattern-selector")
		expect(selector).toBeInTheDocument()
		// Should show one of the individual commands from the && chain
		expect(selector.textContent).toMatch(/npm install|npm test|npm/)
	})

	it("should not show pattern selector for empty commands", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="" isExpanded={true} />
			</ExtensionStateWrapper>,
		)

		expect(screen.queryByTestId("command-pattern-selector")).not.toBeInTheDocument()
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

		it("previews the first line of a multi-line command with an ellipsis", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-preview-multi" text={multiLineCommand} />
				</ExtensionStateWrapper>,
			)

			expect(screen.getByText("python3 - <<'EOF'…")).toBeInTheDocument()
		})

		it("previews a single-line command without an ellipsis", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-preview-single" text="npm install" />
				</ExtensionStateWrapper>,
			)

			expect(screen.getByText("npm install")).toBeInTheDocument()
			expect(screen.queryByText(/…/)).not.toBeInTheDocument()
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

	it("should handle undefined allowedCommands and deniedCommands", () => {
		const stateWithUndefined = {
			...mockExtensionState,
			allowedCommands: undefined,
			deniedCommands: undefined,
		}

		render(
			<ExtensionStateContext.Provider value={stateWithUndefined as any}>
				<CommandExecution executionId="test-1" text="npm install" isExpanded={true} />
			</ExtensionStateContext.Provider>,
		)

		// Should show pattern selector when patterns are available
		expect(screen.getByTestId("command-pattern-selector")).toBeInTheDocument()
	})

	it("should handle command change when moving from denied to allowed", () => {
		// Update the mock state to have "rm file.txt" in deniedCommands
		const stateWithRmInDenied = {
			...mockExtensionState,
			allowedCommands: ["npm"],
			deniedCommands: ["rm file.txt"],
		}

		render(
			<ExtensionStateContext.Provider value={stateWithRmInDenied as any}>
				<CommandExecution executionId="test-1" text="rm file.txt" isExpanded={true} />
			</ExtensionStateContext.Provider>,
		)

		const allowButton = screen.getByText("Allow")
		fireEvent.click(allowButton)

		// "rm file.txt" should be removed from denied and added to allowed
		expect(stateWithRmInDenied.setAllowedCommands).toHaveBeenCalledWith(["npm", "rm file.txt"])
		expect(stateWithRmInDenied.setDeniedCommands).toHaveBeenCalledWith([])
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: {
				allowedCommands: ["npm", "rm file.txt"],
				deniedCommands: [],
			},
		})
	})

	describe("integration with CommandPatternSelector", () => {
		it("should show complex commands with multiple operators", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution
						executionId="test-6"
						text="npm install && npm test || echo 'failed'"
						isExpanded={true}
					/>
				</ExtensionStateWrapper>,
			)

			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()
			// Should show one of the individual commands from the complex chain
			expect(selector.textContent).toMatch(/npm install|npm test|echo|npm/)
		})

		it("should handle commands with output", () => {
			const commandWithOutput = `npm install
Output:
Installing packages...
Other output here`

			render(
				<ExtensionStateWrapper>
					<CommandExecution
						executionId="test-6"
						text={commandWithOutput}
						icon={<span>icon</span>}
						title={<span>Run Command</span>}
						isExpanded={true}
					/>
				</ExtensionStateWrapper>,
			)

			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()
			// Should show the command in the selector
			expect(selector).toHaveTextContent("npm install")
		})

		it("should handle commands with subshells", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-7" text="echo $(whoami) && git status" isExpanded={true} />
				</ExtensionStateWrapper>,
			)

			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()
			// Should show one of the individual commands
			expect(selector.textContent).toMatch(/echo|whoami|git status|git/)
		})

		it("should handle commands with backtick subshells", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-8" text="git commit -m `date`" isExpanded={true} />
				</ExtensionStateWrapper>,
			)

			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()
			// Should show one of the individual commands
			expect(selector.textContent).toMatch(/git commit|date|git/)
		})

		it("should handle commands with special characters", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-9" text="cd ~/projects && npm start" isExpanded={true} />
				</ExtensionStateWrapper>,
			)

			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()
			// Should show one of the individual commands
			expect(selector.textContent).toMatch(/cd ~\/projects|npm start|cd|npm/)
		})

		it("should handle commands with mixed content including output", () => {
			const commandWithMixedContent = `npm test
Output:
Running tests...
✓ Test 1 passed
✓ Test 2 passed`

			render(
				<ExtensionStateWrapper>
					<CommandExecution
						executionId="test-10"
						text={commandWithMixedContent}
						icon={<span>icon</span>}
						title={<span>Run Command</span>}
						isExpanded={true}
					/>
				</ExtensionStateWrapper>,
			)

			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()
			// Should show the command in the selector
			expect(selector).toHaveTextContent("npm test")
		})

		it("should update both allowed and denied lists when commands conflict", () => {
			const conflictState = {
				...mockExtensionState,
				allowedCommands: ["git"],
				deniedCommands: ["git push origin main"],
			}

			render(
				<ExtensionStateContext.Provider value={conflictState as any}>
					<CommandExecution executionId="test-11" text="git push origin main" isExpanded={true} />
				</ExtensionStateContext.Provider>,
			)

			// Click to allow "git push origin main"
			const allowButton = screen.getByText("Allow")
			fireEvent.click(allowButton)

			// Should add to allowed and remove from denied
			expect(conflictState.setAllowedCommands).toHaveBeenCalledWith(["git", "git push origin main"])
			expect(conflictState.setDeniedCommands).toHaveBeenCalledWith([])
		})

		it("should handle commands with special quotes", () => {
			// Test with a command that has quotes
			const commandWithQuotes = "echo 'test with unclosed quote"

			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-12" text={commandWithQuotes} isExpanded={true} />
				</ExtensionStateWrapper>,
			)

			// Should still render the command
			expect(screen.getByTestId("code-block")).toHaveTextContent("echo 'test with unclosed quote")

			// Should show pattern selector with a command pattern
			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()
			expect(selector.textContent).toMatch(/echo/)
		})

		it("should handle empty or whitespace-only commands", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-13" text="   " isExpanded={true} />
				</ExtensionStateWrapper>,
			)

			// Should render without errors
			expect(screen.getByTestId("code-block")).toBeInTheDocument()

			// Should not show pattern selector for empty commands
			expect(screen.queryByTestId("command-pattern-selector")).not.toBeInTheDocument()
		})

		it("should handle commands with only output and no command prefix", () => {
			const outputOnly = `Some output without a command
Multiple lines of output
Without any command prefix`

			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-14" text={outputOnly} isExpanded={true} />
				</ExtensionStateWrapper>,
			)

			// Should treat the entire text as command when no prefix is found
			const codeBlock = screen.getByTestId("code-block")
			// The mock CodeBlock component renders text content without preserving newlines
			expect(codeBlock.textContent).toContain("Some output without a command")
			expect(codeBlock.textContent).toContain("Multiple lines of output")
			expect(codeBlock.textContent).toContain("Without any command prefix")
		})

		it("should handle simple commands", () => {
			const plainCommand = "docker build ."

			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-15" text={plainCommand} isExpanded={true} />
				</ExtensionStateWrapper>,
			)

			// Should render the command
			expect(screen.getByTestId("code-block")).toHaveTextContent("docker build .")

			// Should show pattern selector with the full command
			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()
			expect(selector).toHaveTextContent("docker build .")

			// Verify no output is shown (since there's no Output: separator)
			const codeBlocks = screen.getAllByTestId("code-block")
			expect(codeBlocks).toHaveLength(1) // Only the command block, no output block
		})

		it("should handle commands with numeric output", () => {
			const commandWithNumericOutput = `wc -l *.go *.java
Output:
			   10 file1.go
			   20 file2.go
			   15 Main.java
			   45 total`

			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-16" text={commandWithNumericOutput} isExpanded={true} />
				</ExtensionStateWrapper>,
			)

			// Should render the command and output
			const codeBlocks = screen.getAllByTestId("code-block")
			expect(codeBlocks[0]).toHaveTextContent("wc -l *.go *.java")

			// Should show pattern selector
			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()

			// Should show a command pattern
			expect(selector.textContent).toMatch(/wc/)

			// The output should still be displayed
			const terminalOutput = screen.getByTestId("terminal-output")
			expect(terminalOutput).toBeInTheDocument()
			expect(terminalOutput.textContent).toContain("45 total")
		})

		it("should handle commands with zero output", () => {
			const commandWithZeroTotal = `wc -l *.go *.java
Output:
		     0 total`

			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-17" text={commandWithZeroTotal} isExpanded={true} />
				</ExtensionStateWrapper>,
			)

			// Should show pattern selector
			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()

			// Should show a command pattern
			expect(selector.textContent).toMatch(/wc/)

			// The output should still be displayed
			const terminalOutput = screen.getByTestId("terminal-output")
			expect(terminalOutput).toBeInTheDocument()
			expect(terminalOutput).toHaveTextContent("0 total")
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
