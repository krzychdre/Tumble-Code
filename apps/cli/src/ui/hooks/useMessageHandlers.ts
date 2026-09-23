import { useCallback, useRef } from "react"
import type { ExtensionMessage, ClineMessage, ClineAsk, ClineSay, TodoItem } from "@roo-code/types"
import { consolidateTokenUsage, consolidateApiRequests, consolidateCommands } from "@roo-code/core/cli"

import type { TUIMessage, ToolData } from "../types.js"
import type { FileResult, SlashCommandResult, ModeResult } from "../components/autocomplete/index.js"
import { useCLIStore } from "../store.js"
import { extractToolData, formatToolOutput, formatToolAskMessage, parseTodosFromToolInfo } from "../utils/tools.js"
import { parseMcpAsk, type McpAskDetails } from "../../lib/utils/mcp-ask.js"

export interface UseMessageHandlersOptions {
	nonInteractive: boolean
}

export interface UseMessageHandlersReturn {
	handleExtensionMessage: (msg: ExtensionMessage) => void
	seenMessageIds: React.MutableRefObject<Set<string>>
	pendingCommandRef: React.MutableRefObject<string | null>
	firstTextMessageSkipped: React.MutableRefObject<boolean>
}

/**
 * Say kinds the CLI renders as ONE continuous streaming block.
 *
 * The answer class holds both `text` and `completion_result` because models
 * (GLM especially) repeat the whole answer inside attempt_completion's result,
 * so the two kinds carry the same block under different timestamps.
 */
type StreamClass = "answer" | "reasoning"

function streamClassOf(say: ClineSay): StreamClass | undefined {
	if (say === "text" || say === "completion_result") {
		return "answer"
	}

	if (say === "reasoning") {
		return "reasoning"
	}

	return undefined
}

/**
 * Hook to handle messages from the extension.
 *
 * Processes three types of messages:
 * 1. "say" messages - Information from the agent (text, tool output, reasoning)
 * 2. "ask" messages - Requests for user input (approvals, followup questions)
 * 3. Extension state updates - Mode changes, task history, file search results
 *
 * Transforms ClineMessage format to TUIMessage format and updates the store.
 */
export function useMessageHandlers({ nonInteractive }: UseMessageHandlersOptions): UseMessageHandlersReturn {
	const {
		addMessage,
		setPendingAsk,
		setComplete,
		setLoading,
		setHasStartedTask,
		setFileSearchResults,
		setAllSlashCommands,
		setAvailableModes,
		setCurrentMode,
		setTokenUsage,
		setRouterModels,
		setApiConfiguration,
		setTaskHistory,
		currentTodos,
		setTodos,
	} = useCLIStore()

	// Track seen message timestamps to filter duplicates and the prompt echo
	const seenMessageIds = useRef<Set<string>>(new Set())
	// The message that currently carries each stream class: its id (ts as a
	// string) and the exact text we rendered for it. The core can continue or
	// finalize a stream under a NEW ts (see handleSayMessage), so we need the
	// text to recognise such a delivery and the id to apply it to the message
	// that is already on screen instead of adding a second one.
	const lastStreamed = useRef<Record<StreamClass, { id: string; text: string } | null>>({
		answer: null,
		reasoning: null,
	})
	// ts (as a string) of a stream the core restarted under a new ts, mapped to
	// the message that already carries that stream. Every later delivery for the
	// restarted ts is routed to the merged message, so one answer stays one
	// message instead of a truncated fragment plus the full text.
	const mergedStreamIds = useRef<Map<string, string>>(new Map())
	const firstTextMessageSkipped = useRef(false)
	// The extension host subscribes to handleExtensionMessage once on mount.
	// Keep the current session policy in a ref so runtime /permissions changes
	// affect that stable listener instead of leaving it with the startup value.
	const nonInteractiveRef = useRef(nonInteractive)
	nonInteractiveRef.current = nonInteractive

	// The command of the execution that is currently producing output. Set by
	// `ask: command` and held until the NEXT `ask: command`, deliberately not
	// consumed by the first output chunk: `addMessage` replaces a message
	// wholesale when its finalization arrives, so a command missing from that
	// last delivery is a command missing from the row.
	const pendingCommandRef = useRef<string | null>(null)
	// Id of the row collecting that execution's output, so every later delivery
	// of the same output is routed to it instead of adding a second row.
	const commandRowRef = useRef<string | null>(null)
	// The MCP call the next `say: mcp_server_response` answers. The response
	// carries only the server's output, so the row takes its server and tool
	// from the `ask: use_mcp_server` that preceded it.
	const pendingMcpRef = useRef<McpAskDetails | undefined>(undefined)

	/**
	 * Map extension "say" messages to TUI messages
	 */
	const handleSayMessage = useCallback(
		(ts: number, say: ClineSay, text: string, partial: boolean) => {
			const rawMessageId = ts.toString()
			const isResuming = useCLIStore.getState().isResumingTask

			// `seenMessageIds` is cleared when the task is cleared (/new) or
			// switched, and the merge map and the command refs have exactly that
			// lifetime, so mirror the reset here instead of threading a second ref
			// through every caller.
			if (seenMessageIds.current.size === 0) {
				mergedStreamIds.current.clear()
				commandRowRef.current = null
				pendingCommandRef.current = null
			}

			// Route a delivery for a restarted stream to the message that carries
			// it (see the merge block below).
			let messageId = mergedStreamIds.current.get(rawMessageId) ?? rawMessageId

			if (say === "checkpoint_saved") {
				return
			}

			if (say === "api_req_started") {
				return
			}

			if (say === "user_feedback") {
				seenMessageIds.current.add(messageId)
				// A new user turn begins here: the next assistant reply is a NEW
				// answer, so the same text must be allowed to render again. Reset
				// the greeting-dedupe marker at the user-turn boundary — without
				// this, byte-identical follow-up answers would be wrongly
				// suppressed. The ref still holds DURING a single assistant turn
				// (partial updates append via `messageUpdated`), so the
				// in-turn duplicate collapse keeps working.
				lastStreamed.current = { answer: null, reasoning: null }
				return
			}

			// Skip first text message ONLY for new tasks, not resumed tasks
			// When resuming, we want to show all historical messages including the first one
			if (say === "text" && !firstTextMessageSkipped.current && !isResuming) {
				firstTextMessageSkipped.current = true
				seenMessageIds.current.add(messageId)
				return
			}

			// The core streams an answer as many updates carrying ONE ts and
			// partial=true, then finalizes it with the SAME ts and partial=false
			// (TaskAskSay.ts replaces the partial in place; TaskStreamProcessor.ts
			// does the same for reasoning). That finalization must reach the store,
			// otherwise our copy stays partial forever and `getStaticCount` never
			// promotes the message into <Static>, so the answer only ever renders
			// through the height-clamped dynamic tail and the user cannot read it.
			let existing = useCLIStore.getState().messages.find((m) => m.id === messageId)
			const streamClass = streamClassOf(say)
			const streamed = streamClass ? lastStreamed.current[streamClass] : null

			// Merge a stream the core restarted under a new ts.
			//
			// `Task.say()` only continues a partial in place while that partial is
			// still the LAST message (TaskAskSay.ts:551-554). A model that
			// interleaves reasoning and text breaks that condition, so the core
			// appends a NEW message for the rest of the same answer and abandons
			// the old one, which keeps `partial: true` for the rest of the task.
			// Rendering both puts a truncated fragment ("Dzi") above the full
			// answer, and the abandoned partial also keeps every later message out
			// of the static scrollback.
			//
			// The rest of a stream always starts with what we have already rendered
			// for it, because the core re-says the whole accumulated block on every
			// chunk. That prefix test is what separates a restarted stream from a
			// genuinely new message (a second text block after a tool call does not
			// repeat the first one).
			//
			// Only while the turn is streaming: `getStaticCount` never promotes a
			// partial message while loading, so the message we merge into is
			// guaranteed to be still re-rendered. Once idle it may already be
			// printed into scrollback, where nothing can rewrite it (ink's <Static>
			// prints each item once), so the delivery has to render on its own.
			if (
				!existing &&
				streamed &&
				streamed.id !== messageId &&
				text !== "" &&
				text.startsWith(streamed.text) &&
				useCLIStore.getState().isLoading
			) {
				const restarted = useCLIStore.getState().messages.find((m) => m.id === streamed.id)

				if (restarted?.partial === true) {
					mergedStreamIds.current.set(rawMessageId, streamed.id)
					messageId = streamed.id
					existing = restarted
				}
			}

			// Route every delivery of ONE command execution's output to ONE row.
			//
			// The core emits the first chunk as `say: command_output` partial, then
			// the non-blocking `ask: command_output` ("leave it running?") lands in
			// the same millisecond, which makes the chunk no longer the last
			// message. `Task.say()` only continues a partial in place while it IS
			// the last message, so the completed output is appended under a NEW ts
			// and the chunk is abandoned as a forever-partial. Keying by ts alone
			// therefore renders two `Bash` rows per command, the first holding a
			// single line of output, and the abandoned partial also pins the rest
			// of the turn in the dynamic tail (`getStaticCount` rule 4).
			//
			// The pairing is by execution, not by text: `Terminal.compressTerminalOutput`
			// can drop the middle of a long output, so the completed text is not
			// guaranteed to start with the chunk the way a restarted answer stream is.
			//
			// Guarded like the answer merge above, plus the resume case: while the
			// turn is loading a partial row is never promoted, and a resumed task
			// replays its whole history inside one synchronous loop, so in both
			// windows the row is still re-renderable. Outside them the delivery
			// falls through and renders on its own rather than being written into a
			// row that ink has already printed into scrollback.
			if (say === "command_output" && !existing && commandRowRef.current && commandRowRef.current !== messageId) {
				const state = useCLIStore.getState()

				if (state.isLoading || state.isResumingTask) {
					const row = state.messages.find((m) => m.id === commandRowRef.current)

					if (row) {
						mergedStreamIds.current.set(rawMessageId, row.id)
						messageId = row.id
						existing = row
					}
				}
			}

			const isFinalizingExisting = !partial && existing?.partial === true

			// A partial delivery for a message we already rendered as complete is
			// stale: the core keeps the abandoned partial in `clineMessages`
			// forever (see the orphan comment below) and every `state` push
			// replays the whole array, so this delivery arrives again and again
			// long after we finalized the message. Applying it would flip the
			// message back to `partial: true`, which pins it and everything after
			// it in the height-clamped dynamic tail.
			if (partial && existing && existing.partial !== true) {
				return
			}

			// Drop a repeated delivery of a message we already rendered, UNLESS it
			// finalizes a still-partial store copy. Keeping the guard for already
			// final copies matters because every `state` push replays the whole
			// clineMessages array through here.
			if (seenMessageIds.current.has(messageId) && !partial && !isFinalizingExisting) {
				// Still record it as the newest text of its class. The replay walks
				// the array in order, so without this an orphan partial earlier in
				// the array would leave the marker pointing at its stale text and
				// the next identical delivery would no longer be recognised as a
				// duplicate (it would render a second copy of the answer).
				if (streamClass) {
					lastStreamed.current[streamClass] = { id: messageId, text }
				}

				return
			}

			let role: TUIMessage["role"] = "assistant"
			let toolName: string | undefined
			let toolDisplayName: string | undefined
			let toolDisplayOutput: string | undefined
			let toolData: ToolData | undefined

			if (say === "command_output") {
				role = "tool"
				toolName = "execute_command"
				toolDisplayName = "bash"
				toolDisplayOutput = text
				toolData = {
					tool: "execute_command",
					command: pendingCommandRef.current || undefined,
					output: text,
				}
				// This delivery owns the execution's row from here on, whether it
				// created the row or was routed into it above.
				commandRowRef.current = messageId
			} else if (say === "mcp_server_response") {
				const mcp = pendingMcpRef.current
				role = "tool"
				toolName = "use_mcp_server"
				toolDisplayName = "MCP"
				toolDisplayOutput = text
				toolData = {
					tool: "use_mcp_server",
					path: mcp ? `${mcp.serverName} › ${mcp.toolName ?? mcp.uri ?? ""}` : undefined,
					content: text,
				}
			} else if (say === "reasoning") {
				role = "thinking"
			}

			// Deduplicate an answer repeated under a new ts with identical text.
			// Models (GLM especially) repeat the whole answer inside
			// attempt_completion's result, so the core emits say:text and then
			// say:completion_result with byte-identical text and both would render
			// as an assistant bullet. Unlike the merge above this also fires when
			// the message we already rendered is complete, and it never needs the
			// loading guard: the text is identical, so nothing can be lost by
			// dropping the repeat, even if the original is already in scrollback.
			// A same-ts finalization is not a repeat: it is the completion of the
			// very message it repeats, so it falls through to addMessage.
			const repeated =
				streamed && streamed.id !== messageId
					? useCLIStore.getState().messages.find((m) => m.id === streamed.id)
					: undefined

			if (
				streamClass === "answer" &&
				streamed &&
				!partial &&
				!isFinalizingExisting &&
				streamed.text === text &&
				text !== ""
			) {
				seenMessageIds.current.add(messageId)

				// The repeat carries the COMPLETE text, so it is also the
				// finalization the core could not apply in place. Re-adding the
				// store copy (rather than calling updateMessage) also drops any
				// partial chunk still queued in the store's 150 ms debounce, which
				// would otherwise flip the message back to partial a moment later.
				if (repeated?.partial === true) {
					addMessage({ ...repeated, content: text, partial: false })
				}

				// The marker keeps pointing at the message on screen, not at the
				// delivery we just dropped.
				lastStreamed.current.answer = { id: streamed.id, text }
				return
			}

			seenMessageIds.current.add(messageId)

			// Remember what we actually rendered for this class (partials
			// included), so a later delivery that continues or repeats the same
			// stream under a new ts is recognised instead of rendered twice.
			if (streamClass) {
				lastStreamed.current[streamClass] = { id: messageId, text }
			}

			addMessage({
				id: messageId,
				role,
				content: text || "",
				toolName,
				toolDisplayName,
				toolDisplayOutput,
				partial,
				originalType: say,
				toolData,
			})
		},
		[addMessage],
	)

	/**
	 * Handle extension "ask" messages
	 */
	const handleAskMessage = useCallback(
		(ts: number, ask: ClineAsk, text: string, partial: boolean) => {
			const messageId = ts.toString()

			if (partial) {
				return
			}

			if (seenMessageIds.current.has(messageId)) {
				return
			}

			if (ask === "command_output") {
				seenMessageIds.current.add(messageId)
				return
			}

			// Handle resume_task and resume_completed_task - stop loading and show text input
			// Do not set pendingAsk - just stop loading so user sees normal input to type new message
			if (ask === "resume_task" || ask === "resume_completed_task") {
				seenMessageIds.current.add(messageId)
				setLoading(false)
				// Mark that a task has been started so subsequent messages continue the task
				// (instead of starting a brand new task via runTask)
				setHasStartedTask(true)
				// Clear the resuming flag since we're now ready for interaction
				// Historical messages should already be displayed from state processing
				useCLIStore.getState().setIsResumingTask(false)
				// Do not set pendingAsk - let the normal text input appear
				return
			}

			if (ask === "completion_result") {
				seenMessageIds.current.add(messageId)
				setComplete(true)
				setLoading(false)

				// Parse the completion result and add a message for CompletionTool to render
				try {
					const completionInfo = JSON.parse(text) as Record<string, unknown>
					const toolData: ToolData = {
						tool: "attempt_completion",
						result: completionInfo.result as string | undefined,
						content: completionInfo.result as string | undefined,
					}

					addMessage({
						id: messageId,
						role: "tool",
						content: text,
						toolName: "attempt_completion",
						toolDisplayName: "Task Complete",
						toolDisplayOutput: formatToolOutput({ tool: "attempt_completion", ...completionInfo }),
						originalType: ask,
						toolData,
					})
				} catch {
					// If parsing fails, still add a basic completion message
					addMessage({
						id: messageId,
						role: "tool",
						content: text || "Task completed",
						toolName: "attempt_completion",
						toolDisplayName: "Task Complete",
						toolDisplayOutput: "✅ Task completed",
						originalType: ask,
						toolData: {
							tool: "attempt_completion",
							content: text,
						},
					})
				}
				return
			}

			if (ask === "use_mcp_server") {
				pendingMcpRef.current = parseMcpAsk(text)
			}

			// Track pending command BEFORE nonInteractive handling
			// This ensures we capture the command text for later injection into command_output toolData
			if (ask === "command") {
				pendingCommandRef.current = text
				// A new execution starts here, so its output must open a new row
				// instead of being appended to the previous command's row.
				commandRowRef.current = null
			}

			if (nonInteractiveRef.current && ask !== "followup") {
				seenMessageIds.current.add(messageId)

				// An approved command is not a message of its own. The command text
				// is already on its way to the `Bash(…)` row that `CommandTool`
				// builds from the `say: command_output` that follows (via
				// `pendingCommandRef`, set above), so adding it here as assistant
				// prose printed the same command twice — and rendered as a bare
				// bullet whenever the command contained a pipe. Interactive mode
				// never had this row either: there the ask becomes the approval
				// dialog and disappears once answered (plan: 2026-09-22 empty
				// bullets in the CLI transcript).
				if (ask === "command") {
					return
				}

				// Same for an approved MCP call: its row is built from the
				// `say: mcp_server_response` that follows (via `pendingMcpRef`),
				// instead of printing the ask's raw JSON as assistant prose.
				if (ask === "use_mcp_server") {
					return
				}

				if (ask === "tool") {
					let toolName: string | undefined
					let toolDisplayName: string | undefined
					let toolDisplayOutput: string | undefined
					let formattedContent = text || ""
					let toolData: ToolData | undefined
					let todos: TodoItem[] | undefined
					let previousTodos: TodoItem[] | undefined

					try {
						const toolInfo = JSON.parse(text) as Record<string, unknown>
						toolName = toolInfo.tool as string
						toolDisplayName = toolInfo.tool as string
						toolDisplayOutput = formatToolOutput(toolInfo)
						formattedContent = formatToolAskMessage(toolInfo)
						// Extract structured toolData for rich rendering
						toolData = extractToolData(toolInfo)

						// Special handling for update_todo_list tool - extract todos
						if (toolName === "update_todo_list" || toolName === "updateTodoList") {
							const parsedTodos = parseTodosFromToolInfo(toolInfo)
							if (parsedTodos && parsedTodos.length > 0) {
								todos = parsedTodos
								// Capture previous todos before updating global state
								previousTodos = [...currentTodos]
								setTodos(parsedTodos)
							}
						}
					} catch {
						// Use raw text if not valid JSON
					}

					addMessage({
						id: messageId,
						role: "tool",
						content: formattedContent,
						toolName,
						toolDisplayName,
						toolDisplayOutput,
						originalType: ask,
						toolData,
						todos,
						previousTodos,
					})
				} else {
					addMessage({
						id: messageId,
						role: "assistant",
						content: text || "",
						originalType: ask,
					})
				}
				return
			}

			let suggestions: Array<{ answer: string; mode?: string | null }> | undefined
			let questionText = text

			if (ask === "followup") {
				try {
					const data = JSON.parse(text)
					questionText = data.question || text
					suggestions = Array.isArray(data.suggest) ? data.suggest : undefined
				} catch {
					// Use raw text
				}
			}
			// Note: ask === "command" is handled above before the nonInteractive block

			seenMessageIds.current.add(messageId)

			setPendingAsk({
				id: messageId,
				type: ask,
				content: questionText,
				suggestions,
			})
		},
		[addMessage, setPendingAsk, setComplete, setLoading, setHasStartedTask, currentTodos, setTodos],
	)

	/**
	 * Handle all extension messages
	 */
	const handleExtensionMessage = useCallback(
		(msg: ExtensionMessage) => {
			if (msg.type === "state") {
				const state = msg.state

				if (!state) {
					return
				}

				// Extract and update current mode from state
				const newMode = state.mode

				if (newMode) {
					setCurrentMode(newMode)
				}

				// The provider settings the extension runs with now; a mode
				// switch can change them (per-mode entries in cli-settings.json).
				if (state.apiConfiguration) {
					setApiConfiguration(state.apiConfiguration)
				}

				// Extract and update task history from state
				const newTaskHistory = state.taskHistory

				if (newTaskHistory && Array.isArray(newTaskHistory)) {
					setTaskHistory(newTaskHistory)
				}

				const clineMessages = state.clineMessages

				if (clineMessages) {
					for (const clineMsg of clineMessages) {
						const ts = clineMsg.ts
						const type = clineMsg.type
						const say = clineMsg.say
						const ask = clineMsg.ask
						const text = clineMsg.text || ""
						const partial = clineMsg.partial || false

						if (type === "say" && say) {
							handleSayMessage(ts, say, text, partial)
						} else if (type === "ask" && ask) {
							handleAskMessage(ts, ask, text, partial)
						}
					}

					// Compute token usage metrics from clineMessages
					// Skip first message (task prompt) as per webview UI pattern
					if (clineMessages.length > 1) {
						const processed = consolidateApiRequests(
							consolidateCommands(clineMessages.slice(1) as ClineMessage[]),
						)

						const metrics = consolidateTokenUsage(processed)
						setTokenUsage(metrics)
					}
				}

				// After processing state, clear the resuming flag if it was set
				// This ensures the flag is cleared even if no resume_task ask message is received
				if (useCLIStore.getState().isResumingTask) {
					useCLIStore.getState().setIsResumingTask(false)
				}
			} else if (msg.type === "messageUpdated") {
				const clineMessage = msg.clineMessage

				if (!clineMessage) {
					return
				}

				const ts = clineMessage.ts
				const type = clineMessage.type
				const say = clineMessage.say
				const ask = clineMessage.ask
				const text = clineMessage.text || ""
				const partial = clineMessage.partial || false

				if (type === "say" && say) {
					handleSayMessage(ts, say, text, partial)
				} else if (type === "ask" && ask) {
					handleAskMessage(ts, ask, text, partial)
				}
			} else if (msg.type === "fileSearchResults") {
				setFileSearchResults((msg.results as FileResult[]) || [])
			} else if (msg.type === "commands") {
				setAllSlashCommands((msg.commands as SlashCommandResult[]) || [])
			} else if (msg.type === "modes") {
				setAvailableModes((msg.modes as ModeResult[]) || [])
			} else if (msg.type === "providerModels") {
				// C2: the refactor removed the push-based `routerModels` extension
				// message in favor of the request/response `providerModels` protocol
				// (see webview-ui ApiOptions.tsx + useProviderModels). The CLI
				// consumes the same protocol: each result carries a `sourceId`
				// (which matches the provider name for router-style sources) and a
				// `models` map. Fold it into the store's `routerModels` so
				// `getContextWindow` and any dynamic-model UI keep working.
				const result = msg.modelSourceResult
				if (result?.sourceId && result.models) {
					setRouterModels({ [result.sourceId]: result.models })
				}
			}
		},
		[
			handleSayMessage,
			handleAskMessage,
			setFileSearchResults,
			setAllSlashCommands,
			setAvailableModes,
			setCurrentMode,
			setTokenUsage,
			setRouterModels,
			setApiConfiguration,
			setTaskHistory,
		],
	)

	return {
		handleExtensionMessage,
		seenMessageIds,
		pendingCommandRef,
		firstTextMessageSkipped,
	}
}
