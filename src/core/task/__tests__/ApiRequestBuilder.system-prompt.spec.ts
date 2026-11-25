// cd src && npx vitest run core/task/__tests__/ApiRequestBuilder.system-prompt.spec.ts

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { getAutoMemEntrypoint, initMemoryPaths, resetMemoryPaths } from "../../memory/paths"
import { ApiRequestBuilder, type ApiRequestBuilderAccess } from "../ApiRequestBuilder"

const systemPromptMock = vi.hoisted(() => vi.fn().mockResolvedValue("system prompt"))
vi.mock("../../prompts/system", () => ({ SYSTEM_PROMPT: systemPromptMock }))

function makeBuilder(cwd = "/workspace", taskMode = "architect"): ApiRequestBuilder {
	const provider = {
		getState: vi.fn().mockResolvedValue({ mode: "code", mcpEnabled: false }),
		context: {},
		getSkillsManager: vi.fn().mockReturnValue(undefined),
	}
	const access = {
		taskId: "task-1",
		providerRef: { deref: () => provider },
		api: { getModel: () => ({ id: "m", info: {} }) },
		cwd,
		materializedDeferredTools: new Set<string>(),
		getTaskMode: vi.fn().mockResolvedValue(taskMode),
	} as unknown as ApiRequestBuilderAccess
	return new ApiRequestBuilder(access)
}

/** The SYSTEM_PROMPT({ ... }) input of call `n`. */
const inputOf = (n: number) => systemPromptMock.mock.calls[n][0]

beforeEach(() => {
	systemPromptMock.mockClear()
})

/**
 * The provider state holds the mode of the FOCUSED task. A background subagent or a
 * delegated child can run in another mode, so its system prompt must be built for its
 * own mode (`Task.getTaskMode()`), not for whatever the user is looking at.
 */
describe("ApiRequestBuilder system prompt mode", () => {
	it("builds the system prompt for the task's mode, not the provider's", async () => {
		await makeBuilder().buildSystemPrompt()

		expect(systemPromptMock).toHaveBeenCalledTimes(1)
		expect(inputOf(0).mode).toBe("architect")
	})
})

/**
 * A note saved while a task runs used to change that task's system prompt, which
 * re-prefilled the whole conversation on the next request.
 */
describe("ApiRequestBuilder memory index", () => {
	let base: string
	const cwd = "/workspace"

	beforeEach(async () => {
		base = await fs.mkdtemp(path.join(os.tmpdir(), "memory-index-per-task-"))
		initMemoryPaths(base, () => ({}))
		await fs.mkdir(path.dirname(getAutoMemEntrypoint(cwd)), { recursive: true })
	})

	afterEach(async () => {
		resetMemoryPaths()
		await fs.rm(base, { recursive: true, force: true })
	})

	it("keeps the index a task read first, and a new task reads the file again", async () => {
		await fs.writeFile(getAutoMemEntrypoint(cwd), "- [First](first.md) - one\n")
		const builder = makeBuilder(cwd)
		await builder.buildSystemPrompt()

		await fs.writeFile(getAutoMemEntrypoint(cwd), "- [Second](second.md) - two\n")
		await builder.buildSystemPrompt()
		await makeBuilder(cwd).buildSystemPrompt()

		expect(inputOf(0).memoryIndex).toBe("- [First](first.md) - one\n")
		expect(inputOf(1).memoryIndex).toBe("- [First](first.md) - one\n")
		expect(inputOf(2).memoryIndex).toBe("- [Second](second.md) - two\n")
	})
})
