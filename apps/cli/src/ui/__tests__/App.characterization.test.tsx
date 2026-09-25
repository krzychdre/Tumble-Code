/**
 * Characterization of the whole TUI: `App` rendered through its injectable
 * `createExtensionHost` prop, fed recorded extension message sequences, with
 * every frame the user would see snapshotted after each step.
 *
 * These tests pin today's behavior so that `AppInner` can be split into hooks
 * (and the message interpretation moved) without a visible change. A snapshot
 * diff here means the screen changed: review it as a behavior change, never
 * update it as part of a pure refactor.
 *
 * Determinism: `Date` and the timer functions are faked, so the spinner's
 * elapsed time, the store's 150 ms streaming debounce and toasts only move
 * when a step advances them. `setImmediate` stays real because React's
 * scheduler runs passive effects on it; `flush` alternates the two.
 */

import { EventEmitter } from "events"
import path from "path"
import { stripVTControlCharacters } from "util"

import { render } from "ink-testing-library"

import type { ClineMessage, ExtensionMessage, WebviewMessage } from "@roo-code/types"

import type { ExtensionHostInterface, ExtensionHostOptions } from "@/agent/index.js"
import { TranscriptReader } from "@/agent/transcript-reader.js"

import { App, type TUIAppProps } from "../App.js"
import { useCLIStore } from "../store.js"
import { useUIStateStore } from "../stores/uiStateStore.js"

// ink-testing-library renders in ink's debug mode, which writes the whole
// `<Static>` output and the dynamic tail as one string, so a frame alone
// cannot tell a promoted message from one still in the tail. Record what the
// `<Static>` region was asked to print, so the snapshots also pin the split.
const staticRegion = vi.hoisted(() => ({ last: [] as string[] }))

vi.mock("../components/TranscriptStatic.js", async (importOriginal) => {
	const { default: Real } = await importOriginal<typeof import("../components/TranscriptStatic.js")>()
	return {
		default: (props: Parameters<typeof Real>[0]) => {
			staticRegion.last = props.items.map((item) => `${item.kind}:${item.id}`)
			return <Real {...props} />
		},
	}
})

const realSetImmediate = setImmediate

const WORKSPACE = path.resolve("/tmp/cli-app-characterization")
const START = new Date("2026-01-01T12:00:00Z").getTime()

class FakeHost extends EventEmitter {
	// Not a real ExtensionClient: its events (taskCompleted, error) are emitted
	// by the steps themselves. The transcript reader is the real one, fed from
	// the host's messages from construction on, like ExtensionHost does.
	client = Object.assign(new EventEmitter(), { transcript: new TranscriptReader() })

	constructor() {
		super()
		this.on("extensionWebviewMessage", (message: ExtensionMessage) => this.client.transcript.handleMessage(message))
	}

	sent: WebviewMessage[] = []
	runs: string[] = []
	activate = vi.fn(async () => {})
	runTask = vi.fn(async (prompt: string) => {
		this.runs.push(prompt)
	})
	resumeTask = vi.fn(async () => {})
	sendToExtension = vi.fn((message: WebviewMessage) => {
		this.sent.push(message)
	})
	dispose = vi.fn(async () => {})
}

/** Let React run its passive effects and the faked timers fire, a few rounds. */
async function flush(ms = 200) {
	for (let i = 0; i < 4; i++) {
		await new Promise<void>((resolve) => realSetImmediate(resolve))
		await vi.advanceTimersByTimeAsync(ms / 4)
	}
	await new Promise<void>((resolve) => realSetImmediate(resolve))
}

function normalize(frame: string | undefined): string {
	return stripVTControlCharacters(frame ?? "")
		.split(WORKSPACE)
		.join("<workspace>")
		// figures.ts draws the bullet as ⏺ on macOS.
		.split("⏺")
		.join("●")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
}

function msg(ts: number, fields: Partial<ClineMessage>): ClineMessage {
	return { ts, type: "say", ...fields } as ClineMessage
}

const say = (ts: number, kind: ClineMessage["say"], text: string, partial = false) =>
	msg(ts, { type: "say", say: kind, text, partial })

const ask = (ts: number, kind: ClineMessage["ask"], text: string, partial = false) =>
	msg(ts, { type: "ask", ask: kind, text, partial })

const updated = (clineMessage: ClineMessage): ExtensionMessage =>
	({ type: "messageUpdated", clineMessage }) as ExtensionMessage

const state = (clineMessages: ClineMessage[]): ExtensionMessage =>
	({
		type: "state",
		state: {
			mode: "code",
			apiConfiguration: { apiProvider: "anthropic", apiModelId: "claude-test" },
			taskHistory: [],
			clineMessages,
		},
	}) as unknown as ExtensionMessage

interface Harness {
	host: FakeHost
	frames: Array<{ step: string; frame: string; staticItems: string }>
	/** Deliver one extension message, settle, and record the frame. */
	emit: (step: string, message: ExtensionMessage) => Promise<void>
	/** Type into the terminal, settle, and record the frame. */
	type: (step: string, input: string) => Promise<void>
	/** Settle and record the frame. */
	snap: (step: string) => Promise<void>
	unmount: () => void
}

async function start(options: { nonInteractive?: boolean; prompt?: string } = {}): Promise<Harness> {
	let host: FakeHost | undefined
	const createExtensionHost = (_options: ExtensionHostOptions) => {
		host = new FakeHost()
		return host as unknown as ExtensionHostInterface
	}

	const props: TUIAppProps = {
		initialPrompt: options.prompt ?? "Say hi",
		version: "0.0.0-test",
		mode: "code",
		user: null,
		provider: "anthropic",
		model: "claude-test",
		workspacePath: WORKSPACE,
		extensionPath: path.resolve("/tmp/cli-app-characterization-ext"),
		nonInteractive: options.nonInteractive ?? false,
		ephemeral: true,
		debug: false,
		exitOnComplete: false,
		createExtensionHost,
	}

	const view = render(<App {...props} />)
	const frames: Harness["frames"] = []

	const snap = async (step: string) => {
		await flush()
		frames.push({ step, frame: normalize(view.lastFrame()), staticItems: staticRegion.last.join(" ") })
	}

	await snap("mounted")

	if (!host) {
		throw new Error("App did not create an extension host")
	}

	const created = host

	return {
		host: created,
		frames,
		emit: async (step, message) => {
			created.emit("extensionWebviewMessage", message)
			await snap(step)
		},
		type: async (step, input) => {
			view.stdin.write(input)
			await snap(step)
		},
		snap,
		unmount: () => view.unmount(),
	}
}

/** The prompt echo the core says first; the TUI skips it for new tasks. */
const PROMPT_ECHO = say(1000, "text", "Say hi")
const REQUEST = say(1001, "api_req_started", JSON.stringify({ request: "Say hi" }))

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

function render_(frames: Harness["frames"]): string {
	// The TUI gives the user's own messages random ids; number them instead.
	const ids = new Map<string, string>()
	const stable = (text: string) =>
		text.replace(UUID, (id) => {
			if (!ids.has(id)) {
				ids.set(id, `user-${ids.size + 1}`)
			}
			return ids.get(id)!
		})

	return frames
		.map(({ step, frame, staticItems }) => `=== ${step} ===\n[static: ${stable(staticItems)}]\n${stable(frame)}`)
		.join("\n\n")
}

describe("App characterization (recorded message sequences)", () => {
	const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, "columns")
	const originalRows = Object.getOwnPropertyDescriptor(process.stdout, "rows")

	beforeEach(() => {
		vi.useFakeTimers({
			toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
			now: START,
		})
		// The TUI sizes itself from the real stdout; pin it so a local TTY and
		// CI render the same frames. ink-testing-library itself is 100 wide.
		Object.defineProperty(process.stdout, "columns", { value: 100, configurable: true })
		Object.defineProperty(process.stdout, "rows", { value: 40, configurable: true })
		useCLIStore.getState().reset()
		useUIStateStore.getState().resetUIState()
		staticRegion.last = []
	})

	afterEach(() => {
		vi.useRealTimers()
		for (const [key, descriptor] of [
			["columns", originalColumns],
			["rows", originalRows],
		] as const) {
			if (descriptor) {
				Object.defineProperty(process.stdout, key, descriptor)
			} else {
				delete (process.stdout as unknown as Record<string, unknown>)[key]
			}
		}
	})

	it("streams a plain answer", async () => {
		const h = await start()
		expect(h.host.runs).toEqual(["Say hi"])

		await h.emit("prompt echo", state([PROMPT_ECHO]))
		await h.emit("request started", updated(REQUEST))
		await h.emit("answer partial 1", updated(say(1002, "text", "Hello", true)))
		await h.emit("answer partial 2", updated(say(1002, "text", "Hello, wor", true)))
		await h.emit(
			"answer partial 3 (two lines)",
			updated(say(1002, "text", "Hello, world!\n\nSecond line is", true)),
		)
		await h.emit(
			"answer final",
			updated(say(1002, "text", "Hello, world!\n\nSecond line is here.", false)),
		)

		expect(render_(h.frames)).toMatchSnapshot()
		h.unmount()
	})

	it("shows reasoning, then the answer", async () => {
		const h = await start()

		await h.emit("prompt echo", state([PROMPT_ECHO]))
		await h.emit("request started", updated(REQUEST))
		await h.emit("reasoning partial", updated(say(1002, "reasoning", "The user wants", true)))
		await h.emit(
			"reasoning final",
			updated(say(1002, "reasoning", "The user wants a greeting.", false)),
		)
		await h.emit("answer partial", updated(say(1003, "text", "Hi", true)))
		await h.emit("answer final", updated(say(1003, "text", "Hi there!", false)))

		expect(render_(h.frames)).toMatchSnapshot()
		h.unmount()
	})

	it("asks to approve a tool, and approves it with y", async () => {
		const h = await start()

		await h.emit("prompt echo", state([PROMPT_ECHO]))
		await h.emit("request started", updated(REQUEST))
		await h.emit("intro", updated(say(1002, "text", "Let me read the file.", false)))
		await h.emit(
			"tool ask",
			updated(ask(1003, "tool", JSON.stringify({ tool: "readFile", path: "src/a.ts", content: "src/a.ts" }))),
		)
		await h.type("pressed y", "y")

		expect(h.host.sent).toContainEqual({ type: "askResponse", askResponse: "yesButtonClicked" })

		await h.emit("next request", updated(say(1004, "api_req_started", "{}")))
		await h.emit("answer", updated(say(1005, "text", "The file exports one function.", false)))

		expect(render_(h.frames)).toMatchSnapshot()
		h.unmount()
	})

	it("prints an auto-approved tool as a tool row in allow mode", async () => {
		const h = await start({ nonInteractive: true })

		await h.emit("prompt echo", state([PROMPT_ECHO]))
		await h.emit("request started", updated(REQUEST))
		await h.emit(
			"tool ask (auto-approved)",
			updated(ask(1002, "tool", JSON.stringify({ tool: "readFile", path: "src/a.ts", content: "src/a.ts" }))),
		)
		await h.emit("answer", updated(say(1003, "text", "Read it.", false)))

		expect(h.host.sent.filter((m) => m.type === "askResponse")).toEqual([])
		expect(render_(h.frames)).toMatchSnapshot()
		h.unmount()
	})

	it("draws an artifact read and a history search as tool rows, not as JSON", async () => {
		const h = await start({ nonInteractive: true })

		await h.emit("prompt echo", state([PROMPT_ECHO]))
		await h.emit("request started", updated(REQUEST))
		await h.emit(
			"artifact read",
			updated(
				say(1002, "tool", JSON.stringify({ tool: "readArtifact", readStart: 0, readEnd: 1024, totalBytes: 4096 })),
			),
		)
		await h.emit(
			"history search",
			updated(say(1003, "tool", JSON.stringify({ tool: "searchTaskHistory", query: "retry", totalBytes: 812 }))),
		)
		await h.emit("answer", updated(say(1004, "text", "Found it.", false)))

		const last = h.frames.at(-1)!.frame
		expect(last).toContain("Read Artifact(0 B - 1.0 KB of 4.0 KB)")
		expect(last).toContain("Search Task History(retry)")
		expect(last).not.toContain('"tool"')
		expect(render_(h.frames)).toMatchSnapshot()
		h.unmount()
	})

	it("runs a command and collects its output into one row", async () => {
		const h = await start()

		await h.emit("prompt echo", state([PROMPT_ECHO]))
		await h.emit("request started", updated(REQUEST))
		await h.emit("command ask", updated(ask(1002, "command", "ls -1")))
		await h.type("pressed y", "y")

		expect(h.host.sent).toContainEqual({ type: "askResponse", askResponse: "yesButtonClicked" })

		await h.emit("output chunk", updated(say(1003, "command_output", "a.txt\n", true)))
		await h.emit("output keep-running ask", updated(ask(1004, "command_output", "")))
		await h.emit(
			"output complete (new ts)",
			updated(say(1005, "command_output", "a.txt\nb.txt\nc.txt\n", false)),
		)
		await h.emit("next request", updated(say(1006, "api_req_started", "{}")))
		await h.emit("answer", updated(say(1007, "text", "Three files.", false)))

		expect(render_(h.frames)).toMatchSnapshot()
		h.unmount()
	})

	it("asks a follow-up question and answers with the first suggestion", async () => {
		const h = await start()

		await h.emit("prompt echo", state([PROMPT_ECHO]))
		await h.emit("request started", updated(REQUEST))
		await h.emit(
			"followup ask",
			updated(
				ask(
					1002,
					"followup",
					JSON.stringify({
						question: "Which language?",
						suggest: [{ answer: "Polish" }, { answer: "English" }],
					}),
				),
			),
		)
		await h.type("pressed enter", "\r")

		expect(h.host.sent).toContainEqual(
			expect.objectContaining({ type: "askResponse", askResponse: "messageResponse", text: "Polish" }),
		)

		await h.emit("answer", updated(say(1003, "text", "Cześć!", false)))

		expect(render_(h.frames)).toMatchSnapshot()
		h.unmount()
	})

	it("shows a failed API request as a retry dialog, then a host error", async () => {
		const h = await start()

		await h.emit("prompt echo", state([PROMPT_ECHO]))
		await h.emit("request started", updated(REQUEST))
		await h.emit("api_req_failed ask", updated(ask(1002, "api_req_failed", "401 Unauthorized: invalid x-api-key")))
		await h.type("pressed y (retry)", "y")

		expect(h.host.sent).toContainEqual({ type: "askResponse", askResponse: "yesButtonClicked" })

		h.host.client.emit("error", new Error("Provider went away"))
		await h.snap("host error")

		expect(render_(h.frames)).toMatchSnapshot()
		h.unmount()
	})

	it("completes the task", async () => {
		const h = await start()

		await h.emit("prompt echo", state([PROMPT_ECHO]))
		await h.emit("request started", updated(REQUEST))
		await h.emit("answer", updated(say(1002, "text", "All done here.", false)))
		await h.emit("completion say", updated(say(1003, "completion_result", "Finished the job.", false)))
		await h.emit("completion ask", updated(ask(1004, "completion_result", "")))

		h.host.client.emit("taskCompleted")
		await h.snap("task completed")

		expect(render_(h.frames)).toMatchSnapshot()
		h.unmount()
	})
})
