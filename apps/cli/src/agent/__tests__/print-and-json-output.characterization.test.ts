// Characterization of what print mode and the JSON output modes write for
// recorded extension message sequences (D11, one event stream in the CLI).
//
// Each scenario replays what the core posts to the CLI: a new message is a
// "state" push carrying the WHOLE clineMessages array (TaskMessageLog
// addToClineMessages: the CLI view never takes the single-message post), and
// a change to an existing message is a "messageUpdated" (TaskAskSay continues
// or finalizes a partial in place). The host is wired as activate() wires it,
// so the transcript reader sees each message first and the client second.
//
// Run: cd apps/cli && ./node_modules/.bin/vitest run src/agent/__tests__/print-and-json-output.characterization.test.ts

import { Writable } from "stream"

import type { ClineMessage, ExtensionMessage } from "@roo-code/types"

import { ExtensionHost, type ExtensionHostOptions } from "../extension-host.js"
import { JsonEventEmitter } from "../json-event-emitter.js"

vi.mock("@roo-code/vscode-shim", () => ({
	createVSCodeAPI: vi.fn(() => ({ context: { extensionPath: "/test/extension" } })),
	setRuntimeConfigValues: vi.fn(),
}))

type Msg = Omit<ClineMessage, "type"> & { type: "say" | "ask" }

/** The core's side: owns clineMessages and posts what the CLI receives. */
class CoreFeed {
	readonly messages: ClineMessage[] = []

	constructor(private readonly host: ExtensionHost) {}

	/** A new message: state push with the whole array. */
	add(message: Msg): void {
		this.messages.push({ ...message } as ClineMessage)
		this.pushState()
	}

	/** An in-place change of an existing message (same ts). */
	update(message: Msg): void {
		const index = this.messages.findIndex((m) => m.ts === message.ts)
		this.messages[index] = { ...message } as ClineMessage
		this.post({ type: "messageUpdated", clineMessage: { ...message } as ClineMessage } as ExtensionMessage)
	}

	/** Load a whole history at once (showTaskWithId), as one state push. */
	load(history: Msg[]): void {
		this.messages.push(...(history.map((m) => ({ ...m })) as ClineMessage[]))
		this.pushState()
	}

	pushState(): void {
		this.post({
			type: "state",
			state: { mode: "code", clineMessages: this.messages.map((m) => ({ ...m })) },
		} as unknown as ExtensionMessage)
	}

	private post(message: ExtensionMessage): void {
		this.host.emit("extensionWebviewMessage", message)
	}
}

const say = (ts: number, kind: ClineMessage["say"], text: string, partial = false): Msg => ({
	ts,
	type: "say",
	say: kind,
	text,
	partial,
})

const ask = (ts: number, kind: ClineMessage["ask"], text: string, partial = false): Msg => ({
	ts,
	type: "ask",
	ask: kind,
	text,
	partial,
})

const apiReq = (ts: number, cost?: number): Msg =>
	say(ts, "api_req_started", JSON.stringify(cost === undefined ? { request: "r" } : { request: "r", cost }))

/** A partial stream grown chunk by chunk, then finalized in place. */
function streamThenFinalize(feed: CoreFeed, ts: number, kind: ClineMessage["say"], chunks: string[]): void {
	let text = ""
	chunks.forEach((chunk, index) => {
		text += chunk
		if (index === 0) {
			feed.add(say(ts, kind, text, true))
		} else {
			feed.update(say(ts, kind, text, true))
		}
	})
	feed.update(say(ts, kind, text, false))
}

type Scenario = (feed: CoreFeed, host: ExtensionHost) => void

const SCENARIOS: Record<string, Scenario> = {
	// Prompt echo, one request, an answer streamed and finalized under ONE ts,
	// then attempt_completion (say completion_result + ask completion_result).
	"partial then final, then completion": (feed) => {
		feed.add(say(1, "text", "Say hi"))
		feed.add(apiReq(2))
		streamThenFinalize(feed, 3, "text", ["Hel", "lo ", "there."])
		feed.update(apiReq(2, 0.0123))
		feed.add(say(4, "completion_result", "I said hello."))
		feed.add(ask(5, "completion_result", ""))
	},

	// Reasoning streamed before the answer, both finalized in place.
	"reasoning then answer": (feed) => {
		feed.add(say(1, "text", "Think first"))
		feed.add(apiReq(2, 0.5))
		streamThenFinalize(feed, 3, "reasoning", ["Let me ", "think."])
		streamThenFinalize(feed, 4, "text", ["Answer ", "is 42."])
		feed.add(ask(5, "completion_result", ""))
	},

	// A model interleaving reasoning and text: the core cannot continue the
	// answer in place once reasoning was appended after it, so the rest of
	// the answer arrives as a NEW partial under a new ts that repeats the
	// whole accumulated text. The first partial is abandoned (stays partial
	// in clineMessages, and every state push replays it).
	"restarted stream after interleaved reasoning": (feed) => {
		feed.add(say(1, "text", "Greet me"))
		feed.add(apiReq(2))
		feed.add(say(3, "text", "Dzi", true))
		feed.add(say(4, "reasoning", "Polite form.", true))
		feed.add(say(5, "text", "Dzień", true))
		feed.update(say(5, "text", "Dzień dobry!", true))
		feed.update(say(5, "text", "Dzień dobry!", false))
		feed.add(ask(6, "completion_result", ""))
	},

	// GLM repeats the whole answer inside attempt_completion's result.
	"answer repeated in completion_result": (feed) => {
		feed.add(say(1, "text", "Sum it"))
		feed.add(apiReq(2))
		streamThenFinalize(feed, 3, "text", ["The sum ", "is 5."])
		feed.add(say(4, "completion_result", "The sum is 5."))
		feed.add(ask(5, "completion_result", ""))
	},

	// execute_command: approved command ask, first output chunk as a partial,
	// the non-blocking ask command_output in the same instant, then the
	// completed output appended under a NEW ts (the chunk is no longer last).
	"command output": (feed) => {
		feed.add(say(1, "text", "List files"))
		feed.add(apiReq(2))
		feed.add(ask(3, "command", "ls -1"))
		feed.add(say(4, "command_output", "a.txt", true))
		feed.add(ask(5, "command_output", ""))
		feed.add(say(6, "command_output", "a.txt\nb.txt", false))
		feed.add(apiReq(7))
		streamThenFinalize(feed, 8, "text", ["Two ", "files."])
		feed.add(ask(9, "completion_result", ""))
	},

	// A command whose output is streamed and finalized under one ts.
	"command output finalized in place": (feed) => {
		feed.add(say(1, "text", "Run it"))
		feed.add(ask(2, "command", "echo hi"))
		feed.add(say(3, "command_output", "h", true))
		feed.update(say(3, "command_output", "hi", true))
		feed.update(say(3, "command_output", "hi\n", false))
		feed.add(ask(4, "completion_result", ""))
	},

	// Tool asks (auto-approved in this non-interactive run) and a say "tool".
	"tool asks": (feed) => {
		feed.add(say(1, "text", "Read it"))
		feed.add(apiReq(2))
		feed.add(ask(3, "tool", JSON.stringify({ tool: "readFile", path: "src/a.ts", content: "src/a.ts" })))
		feed.add(say(4, "tool", JSON.stringify({ tool: "searchTaskHistory", query: "x" })))
		feed.add(
			ask(
				5,
				"use_mcp_server",
				JSON.stringify({ type: "use_mcp_tool", serverName: "srv", toolName: "t", arguments: "{}" }),
			),
		)
		feed.add(say(6, "mcp_server_response", "mcp result"))
		streamThenFinalize(feed, 7, "text", ["Read."])
		feed.add(ask(8, "completion_result", ""))
	},

	// An error say, then the model recovers.
	"error say": (feed) => {
		feed.add(say(1, "text", "Do it"))
		feed.add(apiReq(2))
		feed.add(say(3, "error", "Something broke"))
		streamThenFinalize(feed, 4, "text", ["Recovered."])
		feed.add(ask(5, "completion_result", ""))
	},

	// Every state push replays the whole array, so each final message is
	// delivered again and again by the pushes that follow it.
	"state push replays": (feed) => {
		feed.add(say(1, "text", "Replay"))
		streamThenFinalize(feed, 2, "text", ["Once."])
		feed.pushState()
		feed.pushState()
		feed.add(say(3, "text", "Twice.", false))
		feed.pushState()
		feed.add(ask(4, "completion_result", ""))
	},

	// Two messages appended before one state push: the push carries both, and
	// the first of them never arrives as a messageUpdated.
	"two new messages in one state push": (feed) => {
		feed.add(say(1, "text", "Batch"))
		feed.add(apiReq(2))
		feed.messages.push(say(3, "text", "First part.") as ClineMessage)
		feed.add(say(4, "text", "Second part."))
		feed.add(ask(5, "completion_result", ""))
	},

	// Resuming a task: the history arrives in one state push, then the
	// resume ask, then the model continues.
	"resumed task": (feed, host) => {
		void host.resumeTask("task-1").catch(() => {})
		feed.load([
			say(1, "text", "Old prompt"),
			apiReq(2, 0.25),
			say(3, "text", "Old answer."),
			say(4, "reasoning", "Old thought."),
		])
		feed.add(ask(5, "resume_task", ""))
		feed.add(say(6, "user_feedback", ""))
		feed.add(apiReq(7))
		streamThenFinalize(feed, 8, "text", ["New ", "answer."])
		feed.add(ask(9, "completion_result", ""))
	},
}

function createHost(options: Partial<ExtensionHostOptions>): ExtensionHost {
	const host = new ExtensionHost({
		mode: "code",
		provider: "openrouter",
		model: "test-model",
		workspacePath: "/test/workspace",
		extensionPath: "/test/extension",
		ephemeral: false,
		debug: false,
		exitOnComplete: false,
		nonInteractive: true,
		integrationTest: true,
		...options,
	})
	;(host as unknown as { isReady: boolean }).isReady = true
	// What activate() adds once the extension is up: the client listens after
	// the transcript reader, which the constructor subscribed.
	host.on("extensionWebviewMessage", (message: ExtensionMessage) => host.client.handleMessage(message))
	return host
}

/** Everything print mode writes, stdout plain and stderr wrapped in «err:…». */
function runPrint(scenario: Scenario): string {
	const chunks: string[] = []
	const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
		chunks.push(String(chunk))
		return true
	})
	const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
		chunks.push(`«err:${String(chunk)}»`)
		return true
	})

	try {
		const host = createHost({ disableOutput: false })
		scenario(new CoreFeed(host), host)
	} finally {
		stdout.mockRestore()
		stderr.mockRestore()
	}

	return chunks.join("")
}

function runJson(scenario: Scenario, mode: "json" | "stream-json"): string {
	const chunks: string[] = []
	const out = new Writable({
		write(chunk, _encoding, callback) {
			chunks.push(chunk.toString())
			callback()
		},
	}) as unknown as NodeJS.WriteStream

	const host = createHost({ disableOutput: true })
	const emitter = new JsonEventEmitter({ mode, stdout: out })
	emitter.attachToClient(host.client)
	scenario(new CoreFeed(host), host)
	emitter.detach()

	return chunks.join("")
}

describe("print mode output (characterization)", () => {
	for (const [name, scenario] of Object.entries(SCENARIOS)) {
		it(name, () => {
			expect(runPrint(scenario)).toMatchSnapshot()
		})
	}
})

describe("JSON output (characterization)", () => {
	for (const [name, scenario] of Object.entries(SCENARIOS)) {
		it(`stream-json: ${name}`, () => {
			expect(runJson(scenario, "stream-json")).toMatchSnapshot()
		})

		it(`json: ${name}`, () => {
			expect(runJson(scenario, "json")).toMatchSnapshot()
		})
	}
})
