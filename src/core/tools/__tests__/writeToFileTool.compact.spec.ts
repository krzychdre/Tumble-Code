/**
 * `write_to_file` under the compact profile: content whose every non-empty
 * line carries read_file's `N | ` prefix is written without it, in the saved
 * content and in the streaming preview. Without the flag the old rule (every
 * line, empty ones included) still decides.
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

beforeEach(() => {
	vi.clearAllMocks()
	mockedExists.mockResolvedValue(false)
})

const NUMBERED = "  1 | # Notes\n  2 | \n  3 | | 09:40 | coffee |\n"

describe("write_to_file line-number stripping", () => {
	it("compact: strips the prefixes when every non-empty line has one (trailing newline, blank lines)", async () => {
		expect(await write(NUMBERED, true)).toBe("# Notes\n\n| 09:40 | coffee |\n")
		expect(await write("1 | a\n\n3 | c", true)).toBe("a\n\nc")
	})

	it("compact: leaves content alone when a non-empty line has no prefix", async () => {
		expect(await write("1 | a\nb\n", true)).toBe("1 | a\nb\n")
		expect(await write("1|a\n2|b\n", true)).toBe("1|a\n2|b\n")
	})

	it("compact: the streaming preview shows the stripped content", async () => {
		const task = createTask(true)
		const block = { name: "write_to_file", params: { path: "notes.md", content: NUMBERED }, partial: true }
		await writeToFileTool.handlePartial(task as any, block as any)
		await writeToFileTool.handlePartial(task as any, block as any)
		expect(task.diffViewProvider.update).toHaveBeenCalledWith("# Notes\n\n| 09:40 | coffee |\n", false)
	})

	for (const flag of [undefined, false]) {
		it(`compactProfile ${String(flag)}: the old rule (every line, empty ones included) is unchanged`, async () => {
			// The trailing newline leaves an empty last line, so the old rule keeps the numbers.
			expect(await write(NUMBERED, flag)).toBe(NUMBERED)
			expect(await write("1 | a\n2 | b", flag)).toBe("a\nb")
		})
	}
})
