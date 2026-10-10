/**
 * `write_to_file` under the compact profile writes exactly what it writes
 * without the flag. Compact read_file prints no line numbers, so a line that
 * looks numbered is real content (a headerless pipe table) and only the old
 * rule (every line numbered, the last one included) strips anything, in the
 * saved content and in the streaming preview alike.
 */
import { fileExistsAtPath } from "../../../utils/fs"
import { applyComputedEdit } from "../helpers/applyComputedEdit"
import { writeToFileTool } from "../WriteToFileTool"

vi.mock("fs/promises", () => ({
	default: { readFile: vi.fn().mockResolvedValue("") },
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn(),
	createDirectoriesForFile: vi.fn().mockResolvedValue([]),
}))

vi.mock("../../../utils/pathUtils", () => ({
	isPathOutsideWorkspace: vi.fn().mockReturnValue(false),
}))

vi.mock("../helpers/applyComputedEdit", () => ({
	applyComputedEdit: vi.fn().mockResolvedValue("saved"),
}))

const mockedExists = vi.mocked(fileExistsAtPath)
const mockedApply = vi.mocked(applyComputedEdit)

function createTask(compactProfile: boolean | undefined) {
	return {
		cwd: "/ws",
		apiConfiguration: { compactProfile },
		consecutiveMistakeCount: 0,
		rooIgnoreController: { validateAccess: vi.fn().mockReturnValue(true) },
		rooProtectedController: { isWriteProtected: vi.fn().mockReturnValue(false) },
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue(undefined),
		recordToolError: vi.fn(),
		processQueuedMessages: vi.fn(),
		providerRef: { deref: vi.fn().mockReturnValue({ getState: vi.fn().mockResolvedValue({ experiments: {} }) }) },
		diffViewProvider: {
			isEditing: false,
			originalContent: "",
			editTypeOf: vi.fn().mockReturnValue(undefined),
			open: vi.fn().mockResolvedValue(undefined),
			update: vi.fn().mockResolvedValue(undefined),
			reset: vi.fn().mockResolvedValue(undefined),
			revertChanges: vi.fn().mockResolvedValue(undefined),
		},
	}
}

async function write(content: string, compactProfile: boolean | undefined): Promise<string> {
	const task = createTask(compactProfile)
	await writeToFileTool.execute(
		{ path: "notes.md", content },
		task as any,
		{
			askApproval: vi.fn(),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		} as any,
	)
	return mockedApply.mock.calls.at(-1)![2] as string
}

async function preview(content: string, compactProfile: boolean | undefined): Promise<string> {
	const task = createTask(compactProfile)
	const block = { name: "write_to_file", params: { path: "notes.md", content }, partial: true }
	// The first call waits for the path to stabilise.
	await writeToFileTool.handlePartial(task as any, block as any)
	await writeToFileTool.handlePartial(task as any, block as any)
	return task.diffViewProvider.update.mock.calls.at(-1)![0] as string
}

beforeEach(() => {
	vi.clearAllMocks()
	mockedExists.mockResolvedValue(false)
})

const NUMBERED = "  1 | # Notes\n  2 | \n  3 | | 09:40 | coffee |\n"
const PIPE_TABLE = "1 | 08:00 | coffee\n2 | 09:40 | coffee\n"

describe("write_to_file line-number stripping", () => {
	for (const flag of [true, false, undefined]) {
		it(`compactProfile ${String(flag)}: only the old rule (every line, the last one included) strips`, async () => {
			// The trailing newline leaves an empty last line, so the old rule keeps the content as written.
			expect(await write(NUMBERED, flag)).toBe(NUMBERED)
			expect(await write(PIPE_TABLE, flag)).toBe(PIPE_TABLE)
			expect(await write("1|a\n2|b\n", flag)).toBe("1|a\n2|b\n")
			expect(await write("1 | a\n2 | b", flag)).toBe("a\nb")
		})

		it(`compactProfile ${String(flag)}: the streaming preview shows what is saved`, async () => {
			expect(await preview(PIPE_TABLE, flag)).toBe(PIPE_TABLE)
			expect(await preview("1 | a\n2 | b", flag)).toBe("a\nb")
		})
	}
})
