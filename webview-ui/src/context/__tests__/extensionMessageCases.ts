/**
 * One row per extension message type the webview state layer handles.
 *
 * Shared by the provider-level table test (messages dispatched as window
 * `message` events through `ExtensionStateContextProvider`) and, later, by the
 * unit tests of the pure reducer, so both levels pin the same behavior.
 *
 * Each case: `seed` messages are applied first (to build a starting state),
 * then `message`; `check` receives the resulting view (the context value, or
 * the equivalent flattened reducer state). `posts` lists the messages the
 * provider must send back to the host for this case (empty when omitted).
 */
import type {
	ClineMessage,
	Command,
	ExtensionMessage,
	ExtensionState,
	HistoryItem,
	MarketplaceInstalledMetadata,
	MarketplaceItem,
	McpServer,
	ProviderSettingsEntry,
	SkillMetadata,
	SubagentSummary,
	WebviewMessage,
} from "@roo-code/types"

export type ExtensionMessageView = ExtensionState & {
	didHydrateState: boolean
	showWelcome: boolean
	filePaths: string[]
	openedTabs: Array<{ label: string; isActive: boolean; path?: string }>
	commands: Command[]
	mcpServers: McpServer[]
	currentCheckpoint?: string
	marketplaceItems?: MarketplaceItem[]
	marketplaceInstalledMetadata?: MarketplaceInstalledMetadata
	skills?: SkillMetadata[]
}

export interface ExtensionMessageCase {
	name: string
	seed?: ExtensionMessage[]
	message: ExtensionMessage
	check: (view: ExtensionMessageView) => void
	/** Messages the provider posts to the host after `message` (in order). */
	posts?: WebviewMessage[]
	/** True when `message` must not change the state object at all. */
	noChange?: boolean
	/** Expected `console.warn` calls caused by `message`. */
	warns?: number
}

export const makeClineMessage = (ts: number, text: string): ClineMessage =>
	({ ts, type: "say", say: "text", text }) as ClineMessage

export const makeHistoryItem = (id: string, ts: number, task = id): HistoryItem =>
	({ id, number: 1, ts, task, tokensIn: 0, tokensOut: 0, totalCost: 0 }) as HistoryItem

const subagent = (taskId: string): SubagentSummary => ({
	taskId,
	parentTaskId: "task-a",
	index: 0,
	mode: "code",
	description: "child",
	status: "running",
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
	startedAt: 1,
	lastActivityAt: 2,
})

const statePush = (state: Partial<ExtensionState>): ExtensionMessage => ({ type: "state", state })

/** A current task "task-a" with two chat messages (ts 1 and 2). */
const chatSeed: ExtensionMessage[] = [
	statePush({
		currentTaskId: "task-a",
		clineMessages: [makeClineMessage(1, "one"), makeClineMessage(2, "two")],
	}),
]

/** Three history items, newest first, and "b" as the current task item. */
const historySeed: ExtensionMessage[] = [
	statePush({
		taskHistory: [makeHistoryItem("c", 30), makeHistoryItem("b", 20), makeHistoryItem("a", 10)],
		currentTaskItem: makeHistoryItem("b", 20),
	}),
]

const ids = (view: ExtensionMessageView) => view.taskHistory.map((h) => h.id)
const texts = (view: ExtensionMessageView) => view.clineMessages.map((m) => m.text)

const mcpServer = { name: "fs", config: "{}", status: "connected" } as McpServer
const skill: SkillMetadata = { name: "review", description: "Review code", path: "/s/SKILL.md", source: "global" }
const command: Command = { name: "deploy", source: "project" }
const marketplaceItem = { id: "m1", name: "Item", type: "mcp" } as unknown as MarketplaceItem
const installed: MarketplaceInstalledMetadata = { project: { m1: { type: "mcp" } }, global: {} }
const profile = { id: "p1", name: "default", apiProvider: "anthropic" } as ProviderSettingsEntry

export const extensionMessageCases: ExtensionMessageCase[] = [
	// state
	{
		name: "state: merges the pushed fields and marks the state hydrated",
		message: statePush({ mode: "architect", customInstructions: "be brief", currentTaskId: "task-a" }),
		check: (view) => {
			expect(view.mode).toBe("architect")
			expect(view.customInstructions).toBe("be brief")
			expect(view.currentTaskId).toBe("task-a")
			expect(view.didHydrateState).toBe(true)
		},
	},
	{
		name: "state: an apiConfiguration without a key shows the welcome screen",
		message: statePush({ apiConfiguration: { apiProvider: "anthropic" } }),
		check: (view) => expect(view.showWelcome).toBe(true),
	},
	{
		name: "state: an apiConfiguration with a key hides the welcome screen",
		seed: [statePush({ apiConfiguration: { apiProvider: "anthropic" } })],
		message: statePush({ apiConfiguration: { apiProvider: "anthropic", apiKey: "sk-test" } }),
		check: (view) => {
			expect(view.showWelcome).toBe(false)
			expect(view.apiConfiguration).toEqual({ apiProvider: "anthropic", apiKey: "sk-test" })
		},
	},
	{
		// The storage-error fallback in TaskHistoryGateway posts only
		// { storageErrorMessage }; that must not replace the chat with the
		// welcome screen of a configured user.
		name: "state: a partial push without apiConfiguration keeps the welcome screen hidden",
		seed: [statePush({ apiConfiguration: { apiProvider: "anthropic", apiKey: "sk-test" } })],
		message: statePush({ storageErrorMessage: "Could not write tasks.json" }),
		check: (view) => {
			expect(view.showWelcome).toBe(false)
			expect(view.storageErrorMessage).toBe("Could not write tasks.json")
			expect(view.apiConfiguration).toEqual({ apiProvider: "anthropic", apiKey: "sk-test" })
		},
	},
	{
		name: "state: a partial push without apiConfiguration keeps the welcome screen shown",
		seed: [statePush({ apiConfiguration: { apiProvider: "anthropic" } })],
		message: statePush({ storageErrorMessage: "Could not write tasks.json" }),
		check: (view) => expect(view.showWelcome).toBe(true),
	},
	{
		name: "state: copies marketplace items and installed metadata",
		message: statePush({ marketplaceItems: [marketplaceItem], marketplaceInstalledMetadata: installed }),
		check: (view) => {
			expect(view.marketplaceItems).toEqual([marketplaceItem])
			expect(view.marketplaceInstalledMetadata).toEqual(installed)
		},
	},
	{
		name: "state: keeps marketplace items when the push omits them",
		seed: [statePush({ marketplaceItems: [marketplaceItem], marketplaceInstalledMetadata: installed })],
		message: statePush({ mode: "code" }),
		check: (view) => {
			expect(view.marketplaceItems).toEqual([marketplaceItem])
			expect(view.marketplaceInstalledMetadata).toEqual(installed)
		},
	},
	{
		name: "state: mcpServers inside a state push do not replace the mcpServers slice",
		seed: [{ type: "mcpServers", mcpServers: [mcpServer] }],
		message: statePush({ mcpServers: [] }),
		check: (view) => expect(view.mcpServers).toEqual([mcpServer]),
	},
	{
		// The host omits an unchanged history from full pushes (CORE-R7).
		name: "state: a push without taskHistory keeps the history the view has",
		seed: historySeed,
		message: statePush({ mode: "ask" }),
		check: (view) => {
			expect(ids(view)).toEqual(["c", "b", "a"])
			expect(view.mode).toBe("ask")
		},
	},
	{
		name: "state: a push with an empty taskHistory clears the history",
		seed: historySeed,
		message: statePush({ taskHistory: [] }),
		check: (view) => expect(ids(view)).toEqual([]),
	},
	{
		name: "state: a push with an older clineMessagesSeq keeps the newer messages",
		seed: [statePush({ clineMessages: [makeClineMessage(1, "new")], clineMessagesSeq: 5 })],
		message: statePush({ clineMessages: [makeClineMessage(1, "stale")], clineMessagesSeq: 4, mode: "ask" }),
		check: (view) => {
			expect(texts(view)).toEqual(["new"])
			expect(view.clineMessagesSeq).toBe(5)
			expect(view.mode).toBe("ask")
		},
	},

	// action
	{
		name: "action toggleAutoApprove: turns auto-approval on and tells the host",
		message: { type: "action", action: "toggleAutoApprove" },
		check: (view) => expect(view.autoApprovalEnabled).toBe(true),
		posts: [{ type: "autoApprovalEnabled", bool: true }],
	},
	{
		name: "action toggleAutoApprove: turns auto-approval off when it was on",
		seed: [statePush({ autoApprovalEnabled: true })],
		message: { type: "action", action: "toggleAutoApprove" },
		check: (view) => expect(view.autoApprovalEnabled).toBe(false),
		posts: [{ type: "autoApprovalEnabled", bool: false }],
	},
	{
		name: "action: other actions leave the state alone",
		message: { type: "action", action: "didBecomeVisible" },
		check: (view) => expect(view.autoApprovalEnabled).toBe(false),
		noChange: true,
	},

	// workspaceUpdated
	{
		name: "workspaceUpdated: sets file paths and opened tabs",
		message: {
			type: "workspaceUpdated",
			filePaths: ["src/a.ts"],
			openedTabs: [{ label: "a.ts", isActive: true, path: "src/a.ts" }],
		},
		check: (view) => {
			expect(view.filePaths).toEqual(["src/a.ts"])
			expect(view.openedTabs).toEqual([{ label: "a.ts", isActive: true, path: "src/a.ts" }])
		},
	},
	{
		name: "workspaceUpdated: missing lists become empty",
		seed: [{ type: "workspaceUpdated", filePaths: ["x"], openedTabs: [{ label: "x", isActive: false }] }],
		message: { type: "workspaceUpdated" },
		check: (view) => {
			expect(view.filePaths).toEqual([])
			expect(view.openedTabs).toEqual([])
		},
	},

	// commands
	{
		name: "commands: sets the command list",
		message: { type: "commands", commands: [command] },
		check: (view) => expect(view.commands).toEqual([command]),
	},
	{
		name: "commands: a missing list becomes empty",
		seed: [{ type: "commands", commands: [command] }],
		message: { type: "commands" },
		check: (view) => expect(view.commands).toEqual([]),
	},

	// messageAdded (CORE-R7: the host sends a new chat message alone instead of the whole list)
	{
		name: "messageAdded: appends the current task's new message and merges the state that came with it",
		seed: chatSeed,
		message: {
			type: "messageAdded",
			sourceTaskId: "task-a",
			messageIndex: 2,
			clineMessage: makeClineMessage(3, "three"),
			state: { mode: "ask", currentTaskTodos: [{ id: "t1", content: "todo", status: "pending" }] },
		},
		check: (view) => {
			expect(texts(view)).toEqual(["one", "two", "three"])
			expect(view.mode).toBe("ask")
			expect(view.currentTaskTodos).toEqual([{ id: "t1", content: "todo", status: "pending" }])
			expect(view.currentTaskId).toBe("task-a")
		},
	},
	{
		name: "messageAdded: replaces a message the view already has (same ts) instead of adding it twice",
		seed: chatSeed,
		message: {
			type: "messageAdded",
			sourceTaskId: "task-a",
			messageIndex: 1,
			clineMessage: makeClineMessage(2, "two, again"),
			state: {},
		},
		check: (view) => expect(texts(view)).toEqual(["one", "two, again"]),
	},
	{
		name: "messageAdded: the first message while no task is current starts the list",
		message: {
			type: "messageAdded",
			sourceTaskId: "task-a",
			messageIndex: 0,
			clineMessage: makeClineMessage(1, "one"),
			state: { currentTaskId: "task-a" },
		},
		check: (view) => {
			expect(texts(view)).toEqual(["one"])
			expect(view.currentTaskId).toBe("task-a")
		},
	},
	{
		name: "messageAdded: a gap in the list keeps the message and asks the host for the whole list",
		seed: chatSeed,
		message: {
			type: "messageAdded",
			sourceTaskId: "task-a",
			messageIndex: 5,
			clineMessage: makeClineMessage(6, "six"),
			state: {},
		},
		check: (view) => expect(texts(view)).toEqual(["one", "two", "six"]),
		posts: [{ type: "resyncClineMessages" }],
	},
	{
		name: "messageAdded: a message of another task leaves the chat alone and asks the host for the whole list",
		seed: chatSeed,
		message: {
			type: "messageAdded",
			sourceTaskId: "task-b",
			messageIndex: 2,
			clineMessage: makeClineMessage(3, "foreign"),
			state: { mode: "ask" },
		},
		check: (view) => expect(texts(view)).toEqual(["one", "two"]),
		posts: [{ type: "resyncClineMessages" }],
	},

	// messageUpdated
	{
		name: "messageUpdated: replaces the message with the same ts",
		seed: chatSeed,
		message: { type: "messageUpdated", clineMessage: makeClineMessage(2, "two, edited") },
		check: (view) => expect(texts(view)).toEqual(["one", "two, edited"]),
	},
	{
		name: "messageUpdated: replaces the last message when two share a ts",
		seed: [statePush({ clineMessages: [makeClineMessage(1, "first"), makeClineMessage(1, "second")] })],
		message: { type: "messageUpdated", clineMessage: makeClineMessage(1, "updated") },
		check: (view) => expect(texts(view)).toEqual(["first", "updated"]),
	},
	{
		name: "messageUpdated: accepts an update from the current task",
		seed: chatSeed,
		message: { type: "messageUpdated", sourceTaskId: "task-a", clineMessage: makeClineMessage(1, "one, edited") },
		check: (view) => expect(texts(view)).toEqual(["one, edited", "two"]),
	},
	{
		name: "messageUpdated: accepts a scoped update while no task is current",
		seed: [statePush({ clineMessages: [makeClineMessage(1, "one")] })],
		message: { type: "messageUpdated", sourceTaskId: "task-x", clineMessage: makeClineMessage(1, "edited") },
		check: (view) => expect(texts(view)).toEqual(["edited"]),
	},
	{
		name: "messageUpdated: ignores an update from another task without a warning",
		seed: chatSeed,
		message: { type: "messageUpdated", sourceTaskId: "task-b", clineMessage: makeClineMessage(2, "foreign") },
		check: (view) => expect(texts(view)).toEqual(["one", "two"]),
		noChange: true,
		warns: 0,
	},
	{
		name: "messageUpdated: drops an update for an unknown ts and warns",
		seed: chatSeed,
		message: { type: "messageUpdated", clineMessage: makeClineMessage(99, "unknown") },
		check: (view) => expect(texts(view)).toEqual(["one", "two"]),
		noChange: true,
		warns: 1,
	},

	// subagentsUpdated
	{
		name: "subagentsUpdated: sets the subagent list",
		seed: chatSeed,
		message: { type: "subagentsUpdated", sourceTaskId: "task-a", subagents: [subagent("c1")] },
		check: (view) => expect(view.subagents?.map((s) => s.taskId)).toEqual(["c1"]),
	},
	{
		name: "subagentsUpdated: drops a non-empty list from another task",
		seed: [...chatSeed, { type: "subagentsUpdated", subagents: [subagent("c1")] }],
		message: { type: "subagentsUpdated", sourceTaskId: "task-b", subagents: [subagent("late")] },
		check: (view) => expect(view.subagents?.map((s) => s.taskId)).toEqual(["c1"]),
		noChange: true,
	},

	// memoryActivity
	{
		name: "memoryActivity: sets the activity counters",
		message: { type: "memoryActivity", memoryActivity: { recall: 1, write: 2 } },
		check: (view) => expect(view.memoryActivity).toEqual({ recall: 1, write: 2 }),
	},
	{
		name: "memoryActivity: a message without counters changes nothing",
		seed: [{ type: "memoryActivity", memoryActivity: { recall: 1, write: 0 } }],
		message: { type: "memoryActivity" },
		check: (view) => expect(view.memoryActivity).toEqual({ recall: 1, write: 0 }),
		noChange: true,
	},

	// skills
	{
		name: "skills: sets the skill list",
		message: { type: "skills", skills: [skill] },
		check: (view) => expect(view.skills).toEqual([skill]),
	},
	{
		name: "skills: a message without skills keeps the list",
		seed: [{ type: "skills", skills: [skill] }],
		message: { type: "skills" },
		check: (view) => expect(view.skills).toEqual([skill]),
		noChange: true,
	},

	// mcpServers
	{
		name: "mcpServers: sets the server list",
		message: { type: "mcpServers", mcpServers: [mcpServer] },
		check: (view) => expect(view.mcpServers).toEqual([mcpServer]),
	},
	{
		name: "mcpServers: a missing list becomes empty",
		seed: [{ type: "mcpServers", mcpServers: [mcpServer] }],
		message: { type: "mcpServers" },
		check: (view) => expect(view.mcpServers).toEqual([]),
	},

	// currentCheckpointUpdated
	{
		name: "currentCheckpointUpdated: sets the current checkpoint",
		message: { type: "currentCheckpointUpdated", text: "abc123" },
		check: (view) => expect(view.currentCheckpoint).toBe("abc123"),
	},
	{
		name: "currentCheckpointUpdated: a message without text clears it",
		seed: [{ type: "currentCheckpointUpdated", text: "abc123" }],
		message: { type: "currentCheckpointUpdated" },
		check: (view) => expect(view.currentCheckpoint).toBeUndefined(),
	},
	{
		name: "currentCheckpointUpdated: the same checkpoint again changes nothing",
		seed: [{ type: "currentCheckpointUpdated", text: "abc123" }],
		message: { type: "currentCheckpointUpdated", text: "abc123" },
		check: (view) => expect(view.currentCheckpoint).toBe("abc123"),
		noChange: true,
	},

	// listApiConfig
	{
		name: "listApiConfig: sets the profile list",
		message: { type: "listApiConfig", listApiConfig: [profile] },
		check: (view) => expect(view.listApiConfigMeta).toEqual([profile]),
	},
	{
		name: "listApiConfig: a missing list becomes empty",
		seed: [{ type: "listApiConfig", listApiConfig: [profile] }],
		message: { type: "listApiConfig" },
		check: (view) => expect(view.listApiConfigMeta).toEqual([]),
	},

	// marketplaceData
	{
		name: "marketplaceData: sets items and installed metadata",
		message: { type: "marketplaceData", marketplaceItems: [marketplaceItem], marketplaceInstalledMetadata: installed },
		check: (view) => {
			expect(view.marketplaceItems).toEqual([marketplaceItem])
			expect(view.marketplaceInstalledMetadata).toEqual(installed)
		},
	},
	{
		name: "marketplaceData: items alone keep the installed metadata",
		seed: [{ type: "marketplaceData", marketplaceItems: [], marketplaceInstalledMetadata: installed }],
		message: { type: "marketplaceData", marketplaceItems: [marketplaceItem] },
		check: (view) => {
			expect(view.marketplaceItems).toEqual([marketplaceItem])
			expect(view.marketplaceInstalledMetadata).toEqual(installed)
		},
	},
	{
		name: "marketplaceData: installed metadata alone keeps the items",
		seed: [{ type: "marketplaceData", marketplaceItems: [marketplaceItem] }],
		message: { type: "marketplaceData", marketplaceInstalledMetadata: installed },
		check: (view) => {
			expect(view.marketplaceItems).toEqual([marketplaceItem])
			expect(view.marketplaceInstalledMetadata).toEqual(installed)
		},
	},
	{
		name: "marketplaceData: an empty message changes nothing",
		seed: [{ type: "marketplaceData", marketplaceItems: [marketplaceItem] }],
		message: { type: "marketplaceData" },
		check: (view) => expect(view.marketplaceItems).toEqual([marketplaceItem]),
		noChange: true,
	},

	// taskHistoryUpdated
	{
		name: "taskHistoryUpdated: replaces the history",
		seed: historySeed,
		message: { type: "taskHistoryUpdated", taskHistory: [makeHistoryItem("z", 99)] },
		check: (view) => expect(ids(view)).toEqual(["z"]),
	},
	{
		name: "taskHistoryUpdated: a message without history changes nothing",
		seed: historySeed,
		message: { type: "taskHistoryUpdated" },
		check: (view) => expect(ids(view)).toEqual(["c", "b", "a"]),
		noChange: true,
	},

	// taskHistoryItemUpdated
	{
		name: "taskHistoryItemUpdated: inserts a new item in newest-first order",
		seed: historySeed,
		message: { type: "taskHistoryItemUpdated", taskHistoryItem: makeHistoryItem("d", 25) },
		check: (view) => expect(ids(view)).toEqual(["c", "d", "b", "a"]),
	},
	{
		name: "taskHistoryItemUpdated: replaces an existing item and re-sorts",
		seed: historySeed,
		message: { type: "taskHistoryItemUpdated", taskHistoryItem: makeHistoryItem("a", 40, "a, renamed") },
		check: (view) => {
			expect(ids(view)).toEqual(["a", "c", "b"])
			expect(view.taskHistory[0].task).toBe("a, renamed")
		},
	},
	{
		name: "taskHistoryItemUpdated: refreshes the current task item when it is the same task",
		seed: historySeed,
		message: { type: "taskHistoryItemUpdated", taskHistoryItem: makeHistoryItem("b", 20, "b, renamed") },
		check: (view) => expect(view.currentTaskItem?.task).toBe("b, renamed"),
	},
	{
		name: "taskHistoryItemUpdated: keeps the current task item for another task",
		seed: historySeed,
		message: { type: "taskHistoryItemUpdated", taskHistoryItem: makeHistoryItem("a", 10, "a, renamed") },
		check: (view) => expect(view.currentTaskItem?.task).toBe("b"),
	},
	{
		name: "taskHistoryItemUpdated: a message without an item changes nothing",
		seed: historySeed,
		message: { type: "taskHistoryItemUpdated" },
		check: (view) => expect(ids(view)).toEqual(["c", "b", "a"]),
		noChange: true,
	},

	// taskHistoryItemDeleted
	{
		name: "taskHistoryItemDeleted: removes the item",
		seed: historySeed,
		message: { type: "taskHistoryItemDeleted", taskHistoryItemId: "a" },
		check: (view) => {
			expect(ids(view)).toEqual(["c", "b"])
			expect(view.currentTaskItem?.id).toBe("b")
		},
	},
	{
		name: "taskHistoryItemDeleted: clears the current task item when it is deleted",
		seed: historySeed,
		message: { type: "taskHistoryItemDeleted", taskHistoryItemId: "b" },
		check: (view) => {
			expect(ids(view)).toEqual(["c", "a"])
			expect(view.currentTaskItem).toBeUndefined()
		},
	},
	{
		name: "taskHistoryItemDeleted: a message without an id changes nothing",
		seed: historySeed,
		message: { type: "taskHistoryItemDeleted" },
		check: (view) => expect(ids(view)).toEqual(["c", "b", "a"]),
		noChange: true,
	},

	// not handled here
	{
		name: "unhandled message types leave the state alone",
		seed: chatSeed,
		message: { type: "selectedImages", images: ["data:image/png;base64,AAAA"] },
		check: (view) => expect(texts(view)).toEqual(["one", "two"]),
		noChange: true,
	},
]
