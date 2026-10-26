// The recall calls against a stubbed fetch: what reaches the network (URL, query, token)
// and how the contract's answers are read.

import type { AuthService } from "@tumble-code/types"

import { CloudAPI } from "../CloudAPI.js"

vi.mock("../config", () => ({
	getTumbleCodeApiUrl: () => "http://cloud.test",
}))

const fetchMock = vi.fn()

const FOLDER = { workspacePath: "/home/ann/tool", repositoryUrl: "https://github.com/acme/tool.git" }

const HIT = {
	sessionId: "task-1",
	projectName: "tool",
	author: "Ann",
	lastActivity: "2026-10-26T18:22:00Z",
	title: "Fix the retry",
	completed: true,
	snippets: ["the retry wrapper"],
}

function answer(status: number, body: unknown) {
	fetchMock.mockResolvedValueOnce(
		new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
	)
}

/** The URL of the only fetch, split into path and query. */
function requested() {
	expect(fetchMock).toHaveBeenCalledTimes(1)
	const [url, init] = fetchMock.mock.calls[0]!
	const parsed = new URL(url as string)
	return {
		path: parsed.pathname,
		query: Object.fromEntries(parsed.searchParams),
		authorization: (init as RequestInit & { headers: Record<string, string> }).headers.Authorization,
	}
}

let api: CloudAPI

beforeEach(() => {
	fetchMock.mockReset()
	vi.stubGlobal("fetch", fetchMock)
	api = new CloudAPI({ getSessionToken: () => "jwt-1" } as unknown as AuthService, () => {})
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("CloudAPI recall calls", () => {
	it("asks for the folder's context with the session token", async () => {
		answer(200, { projectId: "prj_1", projectName: "tool", scope: "members" })

		expect(await api.recallContext(FOLDER)).toEqual({ projectId: "prj_1", projectName: "tool", scope: "members" })
		expect(requested()).toEqual({
			path: "/api/recall/context",
			query: FOLDER,
			authorization: "Bearer jwt-1",
		})
	})

	it("leaves out the remote of a folder without one", async () => {
		answer(200, { projectId: "prj_1", projectName: "tool", scope: "none" })

		await api.recallContext({ workspacePath: "/home/ann/notes" })
		expect(requested().query).toEqual({ workspacePath: "/home/ann/notes" })
	})

	it("searches with the query, the scope, the limit and the asking task", async () => {
		answer(200, { results: [HIT], tooBroad: false })

		const response = await api.recallSearch(FOLDER, {
			query: "retry wrapper",
			scope: "this_project",
			limit: 3,
			excludeTaskId: "task-9",
		})

		expect(response).toEqual({ results: [HIT], tooBroad: false })
		expect(requested()).toMatchObject({
			path: "/api/recall/search",
			query: { ...FOLDER, q: "retry wrapper", scope: "this_project", limit: "3", excludeTaskId: "task-9" },
		})
	})

	it("sends no scope or limit it was not given", async () => {
		answer(200, { results: [], tooBroad: true })

		await api.recallSearch(FOLDER, { query: "retry", excludeTaskId: "task-9" })
		expect(requested().query).toEqual({ ...FOLDER, q: "retry", excludeTaskId: "task-9" })
	})

	it("reads a session page by id, part and offset", async () => {
		const { completed: _completed, snippets: _snippets, ...card } = HIT
		const page = { ...card, part: "conversation", text: "user: fix it", nextOffset: null }
		answer(200, page)

		expect(await api.recallSession(FOLDER, "task/1", { part: "conversation", offset: 8000 })).toEqual(page)
		expect(requested()).toMatchObject({
			path: "/api/recall/sessions/task%2F1",
			query: { ...FOLDER, part: "conversation", offset: "8000" },
		})
	})
})
