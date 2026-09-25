/**
 * Transcript reducer: how the TUI reads the extension's messages.
 *
 * A pure function of (bookkeeping, what the transcript shows now, one
 * extension message) that returns the new bookkeeping plus the ordered list
 * of changes to apply to the transcript. It holds no React and no store, so
 * the same reading can be driven by the TUI hook today and by the client
 * later (CLI-9 step 3).
 *
 * The changes are returned rather than applied because the TUI store gives
 * some of them extra meaning (a partial update of an existing message is
 * debounced for 150 ms, going idle flushes that queue, a step start never
 * moves back), and the caller must keep applying them through the store's own
 * actions, in this order.
 */

import {
	parseFollowUpData,
	type ClineAsk,
	type ClineMessage,
	type ClineSay,
	type ExtensionMessage,
	type McpServer,
	type ModelRecord,
	type ProviderSettings,
	type TodoItem,
	type TokenUsage,
	type UsableSuggestion,
} from "@roo-code/types"
import {
	consolidateApiRequests,
	consolidateCommands,
	consolidateTokenUsage,
	parseToolPayloadText,
} from "@roo-code/core/cli"

import type { PendingAsk, TaskHistoryItem, TUIMessage, ToolData } from "../ui/types.js"
import type { FileResult, ModeResult, SlashCommandResult } from "../ui/components/autocomplete/index.js"
import { extractToolData, formatToolAskMessage, parseTodosFromToolInfo } from "../ui/utils/tools.js"
import { mcpServersFromMessage } from "../lib/utils/mcp-status.js"
import { parseMcpAsk, type McpAskDetails } from "../lib/utils/mcp-ask.js"

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

/** The message that currently carries a stream class, and the exact text rendered for it. */
interface StreamMarker {
	id: string
	text: string
}

/**
 * What the reducer remembers between messages. Nothing here is shown; it is
 * the bookkeeping that turns the core's replays and restarts into one row per
 * message.
 */
export interface TranscriptCursor {
	/** Ids (ts as a string) already rendered or deliberately skipped. */
	readonly seenMessageIds: ReadonlySet<string>
	/** Whether the first say:text of a new task (the prompt echo) was skipped. */
	readonly firstTextMessageSkipped: boolean
	/**
	 * The message that currently carries each stream class. The core can
	 * continue or finalize a stream under a NEW ts, so the text recognises such
	 * a delivery and the id applies it to the message already on screen.
	 */
	readonly lastStreamed: Readonly<Record<StreamClass, StreamMarker | null>>
	/**
	 * ts of a stream the core restarted under a new ts, mapped to the message
	 * that already carries it, so every later delivery for the restarted ts
	 * lands on that message.
	 */
	readonly mergedStreamIds: ReadonlyMap<string, string>
	/**
	 * The command of the execution that is currently producing output. Set by
	 * `ask: command` and held until the NEXT `ask: command`, deliberately not
	 * consumed by the first output chunk: a message is replaced wholesale when
	 * its finalization arrives, so a command missing from that last delivery is
	 * a command missing from the row.
	 */
	readonly pendingCommand: string | null
	/** Id of the row collecting that execution's output. */
	readonly commandRowId: string | null
	/**
	 * The MCP call the next `say: mcp_server_response` answers. The response
	 * carries only the server's output, so the row takes its server and tool
	 * from the `ask: use_mcp_server` that preceded it.
	 */
	readonly pendingMcp: McpAskDetails | undefined
}

export function createTranscriptCursor(): TranscriptCursor {
	return {
		seenMessageIds: new Set(),
		firstTextMessageSkipped: false,
		lastStreamed: { answer: null, reasoning: null },
		mergedStreamIds: new Map(),
		pendingCommand: null,
		commandRowId: null,
		pendingMcp: undefined,
	}
}

/**
 * Forget the current task (/new, /clear, switching to another task).
 *
 * Nothing carries over: the last streamed markers used to survive, so a new
 * task whose first answer repeated the old task's last answer was dropped as
 * a duplicate, and a pending MCP call could name the response of the next
 * task's server.
 */
export function resetTranscriptCursor(): TranscriptCursor {
	return createTranscriptCursor()
}

/** What the reducer reads from the transcript it writes into. */
export interface TranscriptView {
	readonly messages: readonly TUIMessage[]
	readonly isLoading: boolean
	readonly isResumingTask: boolean
	readonly currentTodos: readonly TodoItem[]
}

export type RouterModelsUpdate = Record<string, ModelRecord>

/** One change to the transcript (or to the state around it), in store action terms. */
export type TranscriptEffect =
	| { type: "addMessage"; message: TUIMessage }
	| { type: "setPendingAsk"; ask: PendingAsk }
	| { type: "setComplete"; complete: boolean }
	| { type: "setLoading"; loading: boolean }
	| { type: "setHasStartedTask"; started: boolean }
	| { type: "setIsResumingTask"; resuming: boolean }
	| { type: "markStepStarted"; ts: number }
	| { type: "setTodos"; todos: TodoItem[] }
	| { type: "setTokenUsage"; usage: TokenUsage }
	| { type: "setMcpServers"; servers: McpServer[] }
	| { type: "setCurrentMode"; mode: string }
	| { type: "setApiConfiguration"; config: ProviderSettings }
	| { type: "setTaskHistory"; history: TaskHistoryItem[] }
	| { type: "setFileSearchResults"; results: FileResult[] }
	| { type: "setAllSlashCommands"; commands: SlashCommandResult[] }
	| { type: "setAvailableModes"; modes: ModeResult[] }
	| { type: "setRouterModels"; models: RouterModelsUpdate }

export interface TranscriptReduceOptions {
	/** Auto-approve mode: asks other than followup and api_req_failed are printed, not asked. */
	nonInteractive: boolean
}

export interface TranscriptReduction {
	cursor: TranscriptCursor
	/** The view after the effects, as the store will hold it once its debounce has flushed. */
	view: TranscriptView
	effects: TranscriptEffect[]
}

/**
 * Apply an `addMessage` to a message list the way the TUI store ends up
 * holding it: a new id is appended, a final delivery replaces the message, and
 * a partial delivery for an existing message updates only its content, its
 * partial flag and (when present) its tool data. The store applies that last
 * case after a 150 ms debounce; the reducer only reads the partial flag and
 * the identity of such a message, which the debounce never changes.
 */
export function applyAddMessage(messages: readonly TUIMessage[], message: TUIMessage): TUIMessage[] {
	const index = messages.findIndex((m) => m.id === message.id)

	if (index === -1) {
		return [...messages, message]
	}

	const updated = [...messages]
	const existing = messages[index]!

	updated[index] = message.partial
		? {
				...existing,
				content: message.content,
				partial: true,
				...(message.toolData ? { toolData: message.toolData } : {}),
			}
		: message

	return updated
}

/** Mutable working copy of one reduction; `finish` hands out the immutable result. */
class Reduction {
	private seen: Set<string>
	private seenCopied = false
	private merged: Map<string, string>
	private mergedCopied = false

	firstTextMessageSkipped: boolean
	lastStreamed: Record<StreamClass, StreamMarker | null>
	pendingCommand: string | null
	commandRowId: string | null
	pendingMcp: McpAskDetails | undefined

	messages: readonly TUIMessage[]
	isLoading: boolean
	isResumingTask: boolean
	currentTodos: readonly TodoItem[]

	readonly effects: TranscriptEffect[] = []

	constructor(
		cursor: TranscriptCursor,
		view: TranscriptView,
		readonly options: TranscriptReduceOptions,
	) {
		this.seen = cursor.seenMessageIds as Set<string>
		this.merged = cursor.mergedStreamIds as Map<string, string>
		this.firstTextMessageSkipped = cursor.firstTextMessageSkipped
		this.lastStreamed = { ...cursor.lastStreamed }
		this.pendingCommand = cursor.pendingCommand
		this.commandRowId = cursor.commandRowId
		this.pendingMcp = cursor.pendingMcp

		this.messages = view.messages
		this.isLoading = view.isLoading
		this.isResumingTask = view.isResumingTask
		this.currentTodos = view.currentTodos
	}

	hasSeen(id: string): boolean {
		return this.seen.has(id)
	}

	markSeen(id: string): void {
		if (this.seen.has(id)) {
			return
		}

		if (!this.seenCopied) {
			this.seen = new Set(this.seen)
			this.seenCopied = true
		}

		this.seen.add(id)
	}

	mergedTarget(id: string): string | undefined {
		return this.merged.get(id)
	}

	mergeInto(id: string, target: string): void {
		if (!this.mergedCopied) {
			this.merged = new Map(this.merged)
			this.mergedCopied = true
		}

		this.merged.set(id, target)
	}

	findMessage(id: string): TUIMessage | undefined {
		return this.messages.find((m) => m.id === id)
	}

	addMessage(message: TUIMessage): void {
		this.messages = applyAddMessage(this.messages, message)
		this.effects.push({ type: "addMessage", message })
	}

	setLoading(loading: boolean): void {
		this.isLoading = loading
		this.effects.push({ type: "setLoading", loading })
	}

	setIsResumingTask(resuming: boolean): void {
		this.isResumingTask = resuming
		this.effects.push({ type: "setIsResumingTask", resuming })
	}

	setTodos(todos: TodoItem[]): void {
		this.currentTodos = todos
		this.effects.push({ type: "setTodos", todos })
	}

	emit(effect: TranscriptEffect): void {
		this.effects.push(effect)
	}

	finish(): TranscriptReduction {
		return {
			cursor: {
				seenMessageIds: this.seen,
				firstTextMessageSkipped: this.firstTextMessageSkipped,
				lastStreamed: this.lastStreamed,
				mergedStreamIds: this.merged,
				pendingCommand: this.pendingCommand,
				commandRowId: this.commandRowId,
				pendingMcp: this.pendingMcp,
			},
			view: {
				messages: this.messages,
				isLoading: this.isLoading,
				isResumingTask: this.isResumingTask,
				currentTodos: this.currentTodos,
			},
			effects: this.effects,
		}
	}
}

/**
 * Map an extension "say" message to a transcript row.
 */
function reduceSay(r: Reduction, ts: number, say: ClineSay, text: string, partial: boolean): void {
	const rawMessageId = ts.toString()

	// Route a delivery for a restarted stream to the message that carries it
	// (see the merge block below).
	let messageId = r.mergedTarget(rawMessageId) ?? rawMessageId

	if (say === "checkpoint_saved") {
		return
	}

	if (say === "api_req_started") {
		// Not a row, but it opens the next request to the model: the spinner
		// times the current step from here.
		r.emit({ type: "markStepStarted", ts })
		return
	}

	if (say === "user_feedback") {
		r.markSeen(messageId)
		// A new user turn begins here: the next assistant reply is a NEW
		// answer, so the same text must be allowed to render again. Reset the
		// greeting-dedupe marker at the user-turn boundary; without this,
		// byte-identical follow-up answers would be wrongly suppressed. The
		// marker still holds DURING a single assistant turn (partial updates
		// append via `messageUpdated`), so the in-turn duplicate collapse keeps
		// working.
		r.lastStreamed = { answer: null, reasoning: null }
		return
	}

	// Skip the first text message ONLY for new tasks, not resumed tasks. When
	// resuming, all historical messages are shown, including the first one.
	if (say === "text" && !r.firstTextMessageSkipped && !r.isResumingTask) {
		r.firstTextMessageSkipped = true
		r.markSeen(messageId)
		return
	}

	// The core streams an answer as many updates carrying ONE ts and
	// partial=true, then finalizes it with the SAME ts and partial=false
	// (TaskAskSay.ts replaces the partial in place; TaskStreamProcessor.ts does
	// the same for reasoning). That finalization must reach the transcript,
	// otherwise our copy stays partial forever and `getStaticCount` never
	// promotes the message into <Static>, so the answer only ever renders
	// through the height-clamped dynamic tail and the user cannot read it.
	let existing = r.findMessage(messageId)
	const streamClass = streamClassOf(say)
	const streamed = streamClass ? r.lastStreamed[streamClass] : null

	// Merge a stream the core restarted under a new ts.
	//
	// `Task.say()` only continues a partial in place while that partial is
	// still the LAST message (TaskAskSay.ts:551-554). A model that interleaves
	// reasoning and text breaks that condition, so the core appends a NEW
	// message for the rest of the same answer and abandons the old one, which
	// keeps `partial: true` for the rest of the task. Rendering both puts a
	// truncated fragment ("Dzi") above the full answer, and the abandoned
	// partial also keeps every later message out of the static scrollback.
	//
	// The rest of a stream always starts with what we have already rendered
	// for it, because the core re-says the whole accumulated block on every
	// chunk. That prefix test is what separates a restarted stream from a
	// genuinely new message (a second text block after a tool call does not
	// repeat the first one).
	//
	// Only while the turn is streaming: `getStaticCount` never promotes a
	// partial message while loading, so the message we merge into is
	// guaranteed to be still re-rendered. Once idle it may already be printed
	// into scrollback, where nothing can rewrite it (ink's <Static> prints each
	// item once), so the delivery has to render on its own.
	if (
		!existing &&
		streamed &&
		streamed.id !== messageId &&
		text !== "" &&
		text.startsWith(streamed.text) &&
		r.isLoading
	) {
		const restarted = r.findMessage(streamed.id)

		if (restarted?.partial === true) {
			r.mergeInto(rawMessageId, streamed.id)
			messageId = streamed.id
			existing = restarted
		}
	}

	// Route every delivery of ONE command execution's output to ONE row.
	//
	// The core emits the first chunk as `say: command_output` partial, then the
	// non-blocking `ask: command_output` ("leave it running?") lands in the
	// same millisecond, which makes the chunk no longer the last message.
	// `Task.say()` only continues a partial in place while it IS the last
	// message, so the completed output is appended under a NEW ts and the chunk
	// is abandoned as a forever-partial. Keying by ts alone therefore renders
	// two `Bash` rows per command, the first holding a single line of output,
	// and the abandoned partial also pins the rest of the turn in the dynamic
	// tail (`getStaticCount` rule 4).
	//
	// The pairing is by execution, not by text: `Terminal.compressTerminalOutput`
	// can drop the middle of a long output, so the completed text is not
	// guaranteed to start with the chunk the way a restarted answer stream is.
	//
	// Guarded like the answer merge above, plus the resume case: while the turn
	// is loading a partial row is never promoted, and a resumed task replays
	// its whole history inside one synchronous loop, so in both windows the row
	// is still re-renderable. Outside them the delivery falls through and
	// renders on its own rather than being written into a row that ink has
	// already printed into scrollback.
	if (say === "command_output" && !existing && r.commandRowId && r.commandRowId !== messageId) {
		if (r.isLoading || r.isResumingTask) {
			const row = r.findMessage(r.commandRowId)

			if (row) {
				r.mergeInto(rawMessageId, row.id)
				messageId = row.id
				existing = row
			}
		}
	}

	const isFinalizingExisting = !partial && existing?.partial === true

	// A partial delivery for a message we already rendered as complete is
	// stale: the core keeps the abandoned partial in `clineMessages` forever
	// (see the orphan comment above) and every `state` push replays the whole
	// array, so this delivery arrives again and again long after we finalized
	// the message. Applying it would flip the message back to `partial: true`,
	// which pins it and everything after it in the height-clamped dynamic tail.
	if (partial && existing && existing.partial !== true) {
		return
	}

	// Drop a repeated delivery of a message we already rendered, UNLESS it
	// finalizes a still-partial copy. Keeping the guard for already final
	// copies matters because every `state` push replays the whole clineMessages
	// array through here.
	if (r.hasSeen(messageId) && !partial && !isFinalizingExisting) {
		// Still record it as the newest text of its class. The replay walks the
		// array in order, so without this an orphan partial earlier in the array
		// would leave the marker pointing at its stale text and the next
		// identical delivery would no longer be recognised as a duplicate (it
		// would render a second copy of the answer).
		if (streamClass) {
			r.lastStreamed[streamClass] = { id: messageId, text }
		}

		return
	}

	let role: TUIMessage["role"] = "assistant"
	let toolName: string | undefined
	let toolData: ToolData | undefined

	if (say === "command_output") {
		role = "tool"
		toolName = "execute_command"
		toolData = {
			tool: "execute_command",
			command: r.pendingCommand || undefined,
			output: text,
		}
		// This delivery owns the execution's row from here on, whether it
		// created the row or was routed into it above.
		r.commandRowId = messageId
	} else if (say === "mcp_server_response") {
		const mcp = r.pendingMcp
		role = "tool"
		toolName = "use_mcp_server"
		toolData = {
			tool: "use_mcp_server",
			path: mcp ? `${mcp.serverName} › ${mcp.toolName ?? mcp.uri ?? ""}` : undefined,
			content: text,
		}
	} else if (say === "tool") {
		// A tool reporting what it did (ReadArtifactTool, SearchTaskHistoryTool;
		// old histories also carry runSlashCommand): a tool payload, drawn as the
		// tool row the webview draws for it (SayToolRows.tsx), never as its JSON.
		// A text that does not parse yet is a payload still streaming; like the
		// webview, draw nothing for it until it does.
		const payload = parseToolPayloadText(text)
		if (!payload) {
			return
		}
		role = "tool"
		toolData = extractToolData(payload)
		toolName = toolData.tool
	} else if (say === "reasoning") {
		role = "thinking"
	}

	// Deduplicate an answer repeated under a new ts with identical text. Models
	// (GLM especially) repeat the whole answer inside attempt_completion's
	// result, so the core emits say:text and then say:completion_result with
	// byte-identical text and both would render as an assistant bullet. Unlike
	// the merge above this also fires when the message we already rendered is
	// complete, and it never needs the loading guard: the text is identical, so
	// nothing can be lost by dropping the repeat, even if the original is
	// already in scrollback. A same-ts finalization is not a repeat: it is the
	// completion of the very message it repeats, so it falls through.
	const repeated = streamed && streamed.id !== messageId ? r.findMessage(streamed.id) : undefined

	if (streamClass === "answer" && streamed && !partial && !isFinalizingExisting && streamed.text === text && text !== "") {
		r.markSeen(messageId)

		// The repeat carries the COMPLETE text, so it is also the finalization
		// the core could not apply in place. Re-adding the row (rather than
		// updating its content) also drops any partial chunk still queued in the
		// store's 150 ms debounce, which would otherwise flip the message back to
		// partial a moment later.
		if (repeated?.partial === true) {
			r.addMessage({ ...repeated, content: text, partial: false })
		}

		// The marker keeps pointing at the message on screen, not at the
		// delivery we just dropped.
		r.lastStreamed.answer = { id: streamed.id, text }
		return
	}

	r.markSeen(messageId)

	// Remember what we actually rendered for this class (partials included),
	// so a later delivery that continues or repeats the same stream under a
	// new ts is recognised instead of rendered twice.
	if (streamClass) {
		r.lastStreamed[streamClass] = { id: messageId, text }
	}

	r.addMessage({
		id: messageId,
		role,
		content: text || "",
		toolName,
		partial,
		originalType: say,
		toolData,
	})
}

/**
 * Map an extension "ask" message to a dialog, a row, or nothing.
 */
function reduceAsk(r: Reduction, ts: number, ask: ClineAsk, text: string, partial: boolean, isLast: boolean): void {
	const messageId = ts.toString()

	if (partial) {
		return
	}

	if (r.hasSeen(messageId)) {
		return
	}

	if (ask === "command_output") {
		r.markSeen(messageId)
		return
	}

	// resume_task and resume_completed_task: stop loading and show the normal
	// text input, without a pending ask, so the user types a new message.
	if (ask === "resume_task" || ask === "resume_completed_task") {
		r.markSeen(messageId)
		r.setLoading(false)
		// A task has been started, so the next message continues it instead of
		// starting a brand new task via runTask.
		r.emit({ type: "setHasStartedTask", started: true })
		// Ready for interaction: the historical messages were already shown by
		// the state processing.
		r.setIsResumingTask(false)
		return
	}

	if (ask === "completion_result") {
		r.markSeen(messageId)
		r.emit({ type: "setComplete", complete: true })
		r.setLoading(false)

		// Parse the completion result and add a row for CompletionTool to render.
		try {
			const completionInfo = JSON.parse(text) as Record<string, unknown>
			const toolData: ToolData = {
				tool: "attempt_completion",
				result: completionInfo.result as string | undefined,
				content: completionInfo.result as string | undefined,
			}

			r.addMessage({
				id: messageId,
				role: "tool",
				content: text,
				toolName: "attempt_completion",
				originalType: ask,
				toolData,
			})
		} catch {
			// If parsing fails, still add a basic completion row.
			r.addMessage({
				id: messageId,
				role: "tool",
				content: text || "Task completed",
				toolName: "attempt_completion",
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
		r.pendingMcp = parseMcpAsk(text)
	}

	// Track the pending command BEFORE the auto-approve handling, so the
	// command text reaches the command_output row that follows.
	if (ask === "command") {
		r.pendingCommand = text
		// A new execution starts here, so its output must open a new row
		// instead of being appended to the previous command's row.
		r.commandRowId = null
	}

	// api_req_failed is not an action to approve: with auto-approval on the
	// core asks it only for errors a retry cannot fix (401, 403, 404), so even
	// in "allow" mode it gets the Retry dialog instead of being printed and
	// left unanswered.
	if (r.options.nonInteractive && ask !== "followup" && ask !== "api_req_failed") {
		r.markSeen(messageId)

		// An approved command is not a message of its own. The command text is
		// already on its way to the `Bash(…)` row that `CommandTool` builds from
		// the `say: command_output` that follows (via `pendingCommand`, set
		// above), so adding it here as assistant prose printed the same command
		// twice, and rendered as a bare bullet whenever the command contained a
		// pipe. Interactive mode never had this row either: there the ask
		// becomes the approval dialog and disappears once answered (plan:
		// 2026-09-22 empty bullets in the CLI transcript).
		if (ask === "command") {
			return
		}

		// Same for an approved MCP call: its row is built from the
		// `say: mcp_server_response` that follows (via `pendingMcp`), instead of
		// printing the ask's raw JSON as assistant prose.
		if (ask === "use_mcp_server") {
			return
		}

		if (ask === "tool") {
			let toolName: string | undefined
			let formattedContent = text || ""
			let toolData: ToolData | undefined
			let todos: TodoItem[] | undefined
			let previousTodos: TodoItem[] | undefined

			try {
				const toolInfo = JSON.parse(text) as Record<string, unknown>
				toolName = toolInfo.tool as string
				formattedContent = formatToolAskMessage(toolInfo)
				// Structured toolData for rich rendering.
				toolData = extractToolData(toolInfo)

				// update_todo_list: keep the list on the row and in the transcript.
				if (toolName === "update_todo_list" || toolName === "updateTodoList") {
					const parsedTodos = parseTodosFromToolInfo(toolInfo)
					if (parsedTodos && parsedTodos.length > 0) {
						todos = parsedTodos
						// Capture the previous todos before updating them.
						previousTodos = [...r.currentTodos]
						r.setTodos(parsedTodos)
					}
				}
			} catch {
				// Use the raw text if it is not valid JSON.
			}

			r.addMessage({
				id: messageId,
				role: "tool",
				content: formattedContent,
				toolName,
				originalType: ask,
				toolData,
				todos,
				previousTodos,
			})
		} else {
			r.addMessage({
				id: messageId,
				role: "assistant",
				content: text || "",
				originalType: ask,
			})
		}
		return
	}

	r.markSeen(messageId)

	// Only the ask the transcript ends with is a question. A state push
	// replays the whole history (a resumed task, every new message), and the
	// core waits only on its last message, as the client's agent state reads
	// it (detectAgentState): an older ask was answered long ago.
	if (!isLast) {
		return
	}

	let suggestions: UsableSuggestion[] | undefined
	let questionText = text

	if (ask === "followup") {
		// The rule shared with the webview: suggestions without a usable answer
		// would render as empty rows and could be sent as the reply.
		const followUp = parseFollowUpData(text)
		questionText = followUp.question || text
		suggestions = followUp.suggestions
	}

	r.emit({
		type: "setPendingAsk",
		ask: {
			id: messageId,
			type: ask,
			content: questionText,
			suggestions,
		},
	})
}

/** `isLast`: the message is the last one of the transcript it arrived in (always true for messageUpdated). */
function reduceClineMessage(r: Reduction, message: ClineMessage, isLast: boolean): void {
	const text = message.text || ""
	const partial = message.partial || false

	if (message.type === "say" && message.say) {
		reduceSay(r, message.ts, message.say, text, partial)
	} else if (message.type === "ask" && message.ask) {
		reduceAsk(r, message.ts, message.ask, text, partial, isLast)
	}
}

/**
 * Read one extension message.
 *
 * Handles the "state" push (mode, provider settings, history and the whole
 * clineMessages array), a single "messageUpdated", and the non-transcript
 * messages the TUI keeps (file search results, commands, modes, provider
 * models, MCP servers).
 */
export function reduceExtensionMessage(
	cursor: TranscriptCursor,
	view: TranscriptView,
	message: ExtensionMessage,
	options: TranscriptReduceOptions,
): TranscriptReduction {
	const r = new Reduction(cursor, view, options)

	const mcpServers = mcpServersFromMessage(message)

	if (mcpServers) {
		r.emit({ type: "setMcpServers", servers: mcpServers })
	}

	if (message.type === "state") {
		const state = message.state

		if (!state) {
			return r.finish()
		}

		if (state.mode) {
			r.emit({ type: "setCurrentMode", mode: state.mode })
		}

		// The provider settings the extension runs with now; a mode switch can
		// change them (per-mode entries in cli-settings.json).
		if (state.apiConfiguration) {
			r.emit({ type: "setApiConfiguration", config: state.apiConfiguration })
		}

		if (state.taskHistory && Array.isArray(state.taskHistory)) {
			r.emit({ type: "setTaskHistory", history: state.taskHistory as TaskHistoryItem[] })
		}

		const clineMessages = state.clineMessages

		if (clineMessages) {
			clineMessages.forEach((clineMessage, index) => {
				reduceClineMessage(r, clineMessage, index === clineMessages.length - 1)
			})

			// Token usage from clineMessages, skipping the first message (the
			// task prompt) as the webview does.
			if (clineMessages.length > 1) {
				const processed = consolidateApiRequests(consolidateCommands(clineMessages.slice(1) as ClineMessage[]))
				r.emit({ type: "setTokenUsage", usage: consolidateTokenUsage(processed) })
			}
		}

		// Clear the resuming flag even if no resume_task ask arrived.
		if (r.isResumingTask) {
			r.setIsResumingTask(false)
		}
	} else if (message.type === "messageUpdated") {
		if (message.clineMessage) {
			reduceClineMessage(r, message.clineMessage, true)
		}
	} else if (message.type === "fileSearchResults") {
		r.emit({ type: "setFileSearchResults", results: (message.results as FileResult[]) || [] })
	} else if (message.type === "commands") {
		r.emit({ type: "setAllSlashCommands", commands: (message.commands as SlashCommandResult[]) || [] })
	} else if (message.type === "modes") {
		r.emit({ type: "setAvailableModes", modes: (message.modes as ModeResult[]) || [] })
	} else if (message.type === "providerModels") {
		// The request/response `providerModels` protocol (see webview-ui
		// ApiOptions.tsx + useProviderModels): each result carries a `sourceId`
		// (the provider name for router-style sources) and a `models` map. Fold
		// it into `routerModels` so `getContextWindow` and any dynamic-model UI
		// keep working.
		const result = message.modelSourceResult
		if (result?.sourceId && result.models) {
			r.emit({ type: "setRouterModels", models: { [result.sourceId]: result.models } })
		}
	}

	return r.finish()
}
