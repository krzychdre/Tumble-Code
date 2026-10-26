// The recall tool gate end to end through buildNativeToolsArrayWithRestrictions: the cloud
// client's GET /api/recall/context is the boundary, the folder is a real git checkout.

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import type OpenAI from "openai"

import { buildNativeToolsArrayWithRestrictions } from "../build-tools"
import type { ClineProvider } from "../../webview/ClineProvider"

const cloud = vi.hoisted(() => ({
	authenticated: true,
	recallContext: vi.fn(),
}))

vi.mock("@tumble-code/cloud", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tumble-code/cloud")>()),
	CloudService: {
		hasInstance: () => true,
		instance: {
			isAuthenticated: () => cloud.authenticated,
			getUserInfo: () => ({ id: "user-ann" }),
			getOrganizationId: () => null,
			cloudAPI: { recallContext: cloud.recallContext },
		},
	},
}))

vi.mock("../../../services/code-index/manager", () => ({
	CodeIndexManager: { getInstance: () => undefined },
}))

const provider = { getMcpHub: () => undefined, context: {} } as unknown as ClineProvider

let cwd: string

beforeEach(async () => {
	cloud.authenticated = true
	cloud.recallContext.mockReset()
	// A fresh folder per test: the scope cache lives for the whole module.
	cwd = await fs.mkdtemp(path.join(os.tmpdir(), "build-tools-recall-"))
	await fs.mkdir(path.join(cwd, ".git"))
	await fs.writeFile(
		path.join(cwd, ".git", "config"),
		'[remote "origin"]\n\turl = https://github.com/acme/tool.git\n',
	)
})

afterEach(async () => {
	await fs.rm(cwd, { recursive: true, force: true })
})

async function recallToolsFor(mode: string) {
	const { tools } = await buildNativeToolsArrayWithRestrictions({
		provider,
		cwd,
		mode,
		customModes: undefined,
		experiments: undefined,
		apiConfiguration: undefined,
	})
	return tools
		.map((tool) => (tool as OpenAI.Chat.ChatCompletionFunctionTool).function.name)
		.filter((name) => name.includes("past_session"))
}

describe("recall tools in the request's tool list", () => {
	it("learns the scope once for the folder and follows every mode switch", async () => {
		cloud.recallContext.mockResolvedValue({ projectId: "prj_1", projectName: "tool", scope: "members" })

		expect(await recallToolsFor("code")).toEqual(["search_past_sessions", "read_past_session"])
		expect(await recallToolsFor("orchestrator")).toEqual([])
		expect(await recallToolsFor("ask")).toEqual(["search_past_sessions", "read_past_session"])

		expect(cloud.recallContext.mock.calls).toEqual([
			[{ workspacePath: cwd, repositoryUrl: "https://github.com/acme/tool.git" }],
		])
	})

	it("drops both tools on the next request after a sign-out, without asking the cloud", async () => {
		cloud.recallContext.mockResolvedValue({ projectId: "prj_1", projectName: "tool", scope: "owner" })
		expect(await recallToolsFor("code")).toHaveLength(2)

		cloud.authenticated = false
		expect(await recallToolsFor("code")).toEqual([])
		expect(cloud.recallContext).toHaveBeenCalledTimes(1)
	})

	it("offers neither tool for a project with recall off", async () => {
		cloud.recallContext.mockResolvedValue({ projectId: "prj_1", projectName: "tool", scope: "none" })

		expect(await recallToolsFor("code")).toEqual([])
	})
})
