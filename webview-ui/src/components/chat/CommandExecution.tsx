import { useCallback, useState, useMemo } from "react"
import { t } from "i18next"
import { ChevronDown, OctagonX } from "lucide-react"

import { type ExtensionMessage, type CommandExecutionStatus, commandExecutionStatusSchema } from "@roo-code/types"

import { safeJsonParse } from "@roo/core"
import { COMMAND_OUTPUT_STRING } from "@roo/combineCommandSequences"
import { parseCommand } from "@roo/parse-command"

import { vscode } from "@src/utils/vscode"
import { extractPatternsFromCommand } from "@src/utils/command-parser"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { cn } from "@src/lib/utils"

import { Button, StandardTooltip } from "@src/components/ui"
import CodeBlock from "@src/components/common/CodeBlock"

import { CommandPatternSelector } from "./CommandPatternSelector"
import { TerminalOutput } from "./TerminalOutput"
import { useExtensionMessage } from "@src/utils/extensionBus"

// Module-level cache of the most recent status for each executionId. Populated
// by every onMessage handler so that a CommandExecution component that mounts
// after the "started" event was already delivered can recover the status from
// the cache rather than staying stuck at null.
const statusCache = new Map<string, CommandExecutionStatus>()

interface CommandPattern {
	pattern: string
	description?: string
}

interface CommandExecutionProps {
	executionId: string
	text?: string
	icon?: JSX.Element | null
	title?: JSX.Element | null
	// Expansion is owned by the chat row (ChatView's expandedRows map keyed by
	// message ts), exactly like the other collapsible rows, so the choice
	// survives virtualized unmount/remount and defaults to collapsed. The
	// chevron hides the whole body: the command, its output and the pattern
	// selector. A command can itself be dozens of lines (a script passed
	// through a heredoc), so leaving it mounted kept the row half a screen
	// tall even with the output collapsed.
	isExpanded?: boolean
	onToggleExpand?: () => void
}

export const CommandExecution = ({
	executionId,
	text,
	icon,
	title,
	isExpanded = false,
	onToggleExpand,
}: CommandExecutionProps) => {
	const { allowedCommands = [], deniedCommands = [], setAllowedCommands, setDeniedCommands } = useExtensionState()

	const { command, output: parsedOutput } = useMemo(() => parseCommandAndOutput(text), [text])

	const [streamingOutput, setStreamingOutput] = useState("")
	// Initialize from the module-level cache so that components mounting after
	// the "started" event was delivered still show the running indicator.
	const [status, setStatus] = useState<CommandExecutionStatus | null>(() => statusCache.get(executionId) ?? null)

	// The command's output can either come from the text associated with the
	// task message (this is the case for completed commands) or from the
	// streaming output (this is the case for running commands).
	const output = streamingOutput || parsedOutput

	// A collapsed row hides the command itself, so the header carries a one-line
	// preview to say what is folded away. Blank lines are skipped (a script
	// passed through a heredoc often starts with one) and the ellipsis marks
	// that further lines follow.
	const commandPreview = useMemo(() => {
		const lines = command
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0)

		if (lines.length === 0) {
			return ""
		}

		return lines.length > 1 ? `${lines[0]}…` : lines[0]
	}, [command])

	// Extract command patterns from the actual command that was executed
	const commandPatterns = useMemo<CommandPattern[]>(() => {
		// First get all individual commands (including subshell commands) using parseCommand
		const { commands: allCommands } = parseCommand(command)

		// Then extract patterns from each command using the existing pattern extraction logic
		const allPatterns = new Set<string>()

		// Add all individual commands first. Multi-line patterns (e.g. heredocs,
		// unterminated quotes) are opaque tokens and must not be added verbatim --
		// their body lines would surface as approvable patterns. Only add
		// single-line commands; multi-line tokens are covered by pattern extraction.
		allCommands.forEach((cmd) => {
			if (cmd.trim() && !cmd.includes("\n")) {
				allPatterns.add(cmd.trim())
			}
		})

		// Then add extracted patterns for each command
		allCommands.forEach((cmd) => {
			const patterns = extractPatternsFromCommand(cmd)
			patterns.forEach((pattern) => allPatterns.add(pattern))
		})

		return Array.from(allPatterns).map((pattern) => ({
			pattern,
		}))
	}, [command])

	// Handle pattern changes
	const handleAllowPatternChange = (pattern: string) => {
		const isAllowed = allowedCommands.includes(pattern)
		const newAllowed = isAllowed ? allowedCommands.filter((p) => p !== pattern) : [...allowedCommands, pattern]
		const newDenied = deniedCommands.filter((p) => p !== pattern)

		setAllowedCommands(newAllowed)
		setDeniedCommands(newDenied)

		vscode.postMessage({
			type: "updateSettings",
			updatedSettings: { allowedCommands: newAllowed, deniedCommands: newDenied },
		})
	}

	const handleDenyPatternChange = (pattern: string) => {
		const isDenied = deniedCommands.includes(pattern)
		const newDenied = isDenied ? deniedCommands.filter((p) => p !== pattern) : [...deniedCommands, pattern]
		const newAllowed = allowedCommands.filter((p) => p !== pattern)

		setAllowedCommands(newAllowed)
		setDeniedCommands(newDenied)

		vscode.postMessage({
			type: "updateSettings",
			updatedSettings: { allowedCommands: newAllowed, deniedCommands: newDenied },
		})
	}

	const onMessage = useCallback(
		(message: ExtensionMessage) => {
			if (message.type === "commandExecutionStatus") {
				const result = commandExecutionStatusSchema.safeParse(safeJsonParse(message.text, {}))

				if (result.success) {
					const data = result.data

					if (data.executionId !== executionId) {
						return
					}

					switch (data.status) {
						case "started":
							// Cache the started status so a component that mounts
							// after this event (e.g. after auto-approval causes a
							// fast remount) can recover the running indicator.
							statusCache.set(executionId, data)
							setStatus(data)
							break
						case "exited":
						case "error":
						case "timeout":
							// Terminal states clear the cache so a fresh component
							// mounting after execution ends does not inherit a stale
							// "started" entry and incorrectly show the pulse dot.
							// Map.delete on a missing key is a no-op, so duplicate
							// deletes (e.g. error followed by exited) are safe.
							statusCache.delete(executionId)
							setStatus(data)
							break
						case "fallback":
							// Not a terminal state -- signals a mid-execution retry
							// via execa after a shell integration failure. A new
							// "started" event will follow, so leave the cache intact.
							// The output stays collapsed; the user opens it with the
							// chevron like any other row.
							break
						case "output":
							setStreamingOutput(data.output)
							break
						default:
							setStatus(data)
							break
					}
				}
			}
		},
		[executionId],
	)

	useExtensionMessage("commandExecutionStatus", onMessage)

	return (
		<>
			<div className="flex flex-row items-center justify-between gap-2 mb-1">
				<div className="flex flex-row items-center gap-2 min-w-0 flex-1">
					{icon}
					{title}
					{status?.status === "started" && (
						<StandardTooltip content={t("chat:commandExecution.running")}>
							<div className="rounded-full size-2 bg-yellow-500 animate-pulse" />
						</StandardTooltip>
					)}
					{status?.status === "exited" && (
						<div className="flex flex-row items-center gap-2 font-mono text-xs">
							<StandardTooltip
								content={t("chat.commandExecution.exitStatus", { exitStatus: status.exitCode })}>
								<div
									className={cn(
										"rounded-full size-2",
										status.exitCode === 0 ? "bg-green-600" : "bg-red-600",
									)}
								/>
							</StandardTooltip>
						</div>
					)}
					{status?.status === "error" && (
						<div className="flex flex-row items-center gap-2 font-mono text-xs text-vscode-errorForeground">
							<StandardTooltip content={status.message ?? t("chat:commandExecution.malformedCommand")}>
								<div className="rounded-full size-2 bg-red-600" />
							</StandardTooltip>
						</div>
					)}
					{!isExpanded && commandPreview && (
						<div className="font-mono text-xs text-vscode-descriptionForeground truncate min-w-0">
							{commandPreview}
						</div>
					)}
				</div>
				<div className=" flex flex-row items-center justify-between gap-2 px-1">
					<div className="flex flex-row items-center gap-1">
						{status?.status === "started" && (
							<div className="flex flex-row items-center gap-2 font-mono text-xs">
								{status.pid && <div className="whitespace-nowrap">(PID: {status.pid})</div>}
								<StandardTooltip content={t("chat:commandExecution.abort")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={() =>
											vscode.postMessage({
												type: "terminalOperation",
												terminalOperation: "abort",
											})
										}>
										<OctagonX className="size-4" />
									</Button>
								</StandardTooltip>
							</div>
						)}
						{/* Always shown: a row always has a command to fold away, even
						    before any output has arrived. */}
						<Button
							variant="ghost"
							size="icon"
							aria-label={t(
								isExpanded
									? "chat:commandExecution.collapseCommand"
									: "chat:commandExecution.expandCommand",
							)}
							aria-expanded={isExpanded}
							onClick={onToggleExpand}>
							<ChevronDown
								className={cn("size-4 transition-transform duration-300", isExpanded && "rotate-180")}
							/>
						</Button>
					</div>
				</div>
			</div>

			{/* Nothing below the header is mounted while collapsed: no code block,
			    no ANSI conversion of the output, no pattern selector. */}
			{isExpanded && (
				<div className="bg-vscode-editor-background border border-vscode-border rounded-xs ml-6 mt-2">
					<div className="p-2">
						<CodeBlock source={command} language="shell" />
						{output.length > 0 && (
							<div className="mt-1 pt-1 border-t border-border/25">
								<TerminalOutput content={output} />
							</div>
						)}
					</div>
					{command && command.trim() && (
						<CommandPatternSelector
							patterns={commandPatterns}
							allowedCommands={allowedCommands}
							deniedCommands={deniedCommands}
							onAllowPatternChange={handleAllowPatternChange}
							onDenyPatternChange={handleDenyPatternChange}
						/>
					)}
				</div>
			)}
		</>
	)
}

CommandExecution.displayName = "CommandExecution"

const parseCommandAndOutput = (text: string | undefined) => {
	if (!text) {
		return { command: "", output: "" }
	}

	const index = text.indexOf(COMMAND_OUTPUT_STRING)

	if (index === -1) {
		return { command: text, output: "" }
	}

	return {
		command: text.slice(0, index),
		output: text.slice(index + COMMAND_OUTPUT_STRING.length),
	}
}
