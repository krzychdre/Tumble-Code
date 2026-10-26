// search_past_sessions and read_past_session against a stand-in for the cloud client (the
// boundary: CloudAPI.recallSearch and recallSession), with the task's folder a real git
// checkout in a temporary directory so the remote that reaches the cloud is read for real.

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { CloudAPIError } from "@tumble-code/cloud"

import { SearchPastSessionsTool } from "../SearchPastSessionsTool"
import { ReadPastSessionTool } from "../ReadPastSessionTool"

const cloud = vi.hoisted(() => ({
	present: true,
	api: { recallSearch: vi.fn(), recallSession: vi.fn() },
}))

vi.mock("@tumble-code/cloud", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tumble-code/cloud")>()),
	CloudService: {
		hasInstance: () => cloud.present,
		get instance() {
			return { cloudAPI: cloud.api }
		},
	},
}))

const REMOTE = "https://github.com/acme/tool.git"

const HIT = {
	sessionId: "task-1",
	projectName: "tool",
	author: "Ann",
	lastActivity: "2026-10-26T18:22:00Z",
	title: "Fix the retry wrapper",
	completed: true,
	snippets: ["the retry wrapper now waits", "second snippet"],
}

const PAGE = {
	sessionId: "task-1",
	projectName: "tool",
	author: "Ann",
	lastActivity: "2026-10-26T18:22:00Z",
	title: "Fix the retry wrapper",
	part: "conversation" as const,
	text: "user: fix the retry\nresult: done",
	nextOffset: 8000 as number | null,
}

let cwd: string
let task: any
let pushToolResult: ReturnType<typeof vi.fn>

beforeEach(async () => {
	vi.clearAllMocks()
	cloud.present = true
	cwd = await fs.mkdtemp(path.join(os.tmpdir(), "past-sessions-"))
	await fs.mkdir(path.join(cwd, ".git"))
	await fs.writeFile(path.join(cwd, ".git", "config"), '[remote "origin"]\n\turl = git@github.com:acme/tool.git\n')
	pushToolResult = vi.fn()
	task = {
		taskId: "task-9",
		cwd,
		consecutiveMistakeCount: 2,
		didToolFailInCurrentTurn: false,
		say: vi.fn(async () => undefined),
		sayAndCreateMissingParamError: vi.fn(async () => "Missing parameter"),
		recordToolError: vi.fn(),
	}
})

afterEach(async () => {
	await fs.rm(cwd, { recursive: true, force: true })
})

const callbacks = () => ({ askApproval: vi.fn(), handleError: vi.fn(), pushToolResult }) as any

const search = (params: Record<string, unknown>) =>
	new SearchPastSessionsTool().execute(params as any, task, callbacks())
const read = (params: Record<string, unknown>) => new ReadPastSessionTool().execute(params as any, task, callbacks())

const result = () => pushToolResult.mock.calls[0]![0] as string
const sayRow = () => JSON.parse(task.say.mock.calls.find(([type]: [string]) => type === "tool")[1])

describe("search_past_sessions", () => {
	it("searches the task's folder with its remote, leaving the task itself out", async () => {
		cloud.api.recallSearch.mockResolvedValue({ results: [HIT], tooBroad: false })

		await search({ query: "  retry wrapper ", scope: "this_project", max_results: 50 })

		expect(cloud.api.recallSearch).toHaveBeenCalledWith(
			{ workspacePath: cwd, repositoryUrl: REMOTE },
			{ query: "retry wrapper", scope: "this_project", limit: 10, excludeTaskId: "task-9" },
		)
		expect(result()).toBe(
			[
				'Found 1 past session for "retry wrapper". To read one, call read_past_session with its session_id.',
				"",
				"1. Fix the retry wrapper (completed)",
				"   session_id: task-1 | project: tool | author: Ann | 2026-10-26",
				'   "the retry wrapper now waits"',
				'   "second snippet"',
			].join("\n"),
		)
		expect(sayRow()).toEqual({ tool: "searchPastSessions", query: "retry wrapper", matchCount: 1 })
		expect(task.consecutiveMistakeCount).toBe(0)
	})

	it("leaves an unknown scope and a missing max_results to the defaults", async () => {
		cloud.api.recallSearch.mockResolvedValue({ results: [], tooBroad: false })

		await search({ query: "retry", scope: "everything" })

		expect(cloud.api.recallSearch.mock.calls[0]![1]).toMatchObject({ scope: undefined, limit: 5 })
	})

	it("keeps a hit compact however long the card is", async () => {
		const long = {
			...HIT,
			title: "t".repeat(400),
			snippets: ["s".repeat(1000), "s".repeat(1000), "s".repeat(1000)],
		}
		cloud.api.recallSearch.mockResolvedValue({ results: [long], tooBroad: false })

		await search({ query: "retry" })

		const hit = result().split("\n\n")[1]!
		expect(hit.split("\n")).toHaveLength(4)
		expect(hit.length).toBeLessThan(650)
	})

	it.each([
		[{ results: [], tooBroad: true }, 'The search for "retry" was too broad'],
		[{ results: [], tooBroad: false }, 'No past session matches "retry". Try fewer words'],
	])("tells the model what to do next: %j", async (response, start) => {
		cloud.api.recallSearch.mockResolvedValue(response)

		await search({ query: "retry" })

		expect(result().startsWith(start)).toBe(true)
	})

	it("asks again for a missing query, without calling the cloud", async () => {
		await search({ query: "   " })

		expect(cloud.api.recallSearch).not.toHaveBeenCalled()
		expect(result()).toBe("Missing parameter")
		expect(task.consecutiveMistakeCount).toBe(3)
	})

	it.each([
		[new CloudAPIError("Authentication required", 401), "the user is not signed in", false],
		[new CloudAPIError("Resource not found", 404), "Recall of past sessions is turned off for this project", false],
		[new CloudAPIError("HTTP 429", 429), "Wait about a minute", false],
		[new CloudAPIError("HTTP 400", 400), "The query was rejected", true],
		[new CloudAPIError("HTTP 502", 502), "could not be reached (it answered HTTP 502)", false],
		[new CloudAPIError("Network error"), "could not be reached (offline", false],
	])("maps %s to a result the model can act on", async (error, message, modelMistake) => {
		cloud.api.recallSearch.mockRejectedValue(error)

		await search({ query: "retry" })

		const answer = JSON.parse(result())
		expect(answer.status).toBe("error")
		expect(answer.error).toContain(message)
		// Only a call the model got wrong counts as its mistake and teaches the call's shape.
		expect(answer.minimal_valid_example !== undefined).toBe(modelMistake)
		expect(task.consecutiveMistakeCount).toBe(modelMistake ? 3 : 2)
		expect(task.didToolFailInCurrentTurn).toBe(true)
	})

	it("answers as signed out when there is no cloud at all", async () => {
		cloud.present = false

		await search({ query: "retry" })

		expect(JSON.parse(result()).error).toContain("not signed in")
	})
})

describe("read_past_session", () => {
	it("reads the page it was asked for and names the next one", async () => {
		cloud.api.recallSession.mockResolvedValue(PAGE)

		await read({ session_id: " task-1 ", part: "conversation", offset: 0 })

		expect(cloud.api.recallSession).toHaveBeenCalledWith({ workspacePath: cwd, repositoryUrl: REMOTE }, "task-1", {
			part: "conversation",
			offset: 0,
		})
		expect(result()).toBe(
			[
				"Past session task-1: Fix the retry wrapper",
				"Project: tool | Author: Ann | Last activity: 2026-10-26 | Part: conversation",
				"",
				"user: fix the retry\nresult: done",
				"",
				'More of this conversation follows. To read it, call read_past_session with {"session_id":"task-1","part":"conversation","offset":8000}.',
			].join("\n"),
		)
		expect(sayRow()).toEqual({ tool: "readPastSession", description: "Fix the retry wrapper" })
	})

	it.each([
		[{ ...PAGE, nextOffset: null }, "This is the end of the conversation."],
		[
			{ ...PAGE, part: "summary", nextOffset: null },
			'For the user\'s messages and results in order, call read_past_session with {"session_id":"task-1","part":"conversation"}.',
		],
	])("ends the last page and the summary with what is left: %#", async (page, footer) => {
		cloud.api.recallSession.mockResolvedValue(page)

		await read({ session_id: "task-1", part: "lines" })

		expect(cloud.api.recallSession.mock.calls[0]![2]).toEqual({ part: undefined, offset: undefined })
		expect(result().endsWith(`\n\n${footer}`)).toBe(true)
	})

	it("explains a session it may not see as a wrong id", async () => {
		cloud.api.recallSession.mockRejectedValue(new CloudAPIError("Resource not found", 404))

		await read({ session_id: "task-x" })

		expect(JSON.parse(result()).error).toContain("No such session")
		expect(task.consecutiveMistakeCount).toBe(3)
	})
})
