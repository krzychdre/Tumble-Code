import * as path from "path"

import { pushToolWriteResult, type ToolWriteResultTask } from "../toolWriteResult"

/**
 * Characterization of the tool_result text every file-writing tool
 * (write_to_file, apply_diff, edit, search_replace, edit_file, apply_patch)
 * returns to the model after a save. The strings are pinned literally: weak
 * models key on this exact wording and JSON shape, so moving the code (SVC-17
 * moved it out of DiffViewProvider) must not change a single byte.
 */

const CWD = path.resolve("/work/project")

function makeTask(
	saved: { lastSavedRelPath?: string; userEdits?: string; newProblemsMessage?: string } = {},
): ToolWriteResultTask & { say: ReturnType<typeof vi.fn> } {
	return {
		cwd: CWD,
		say: vi.fn().mockResolvedValue(undefined),
		diffViewProvider: {
			lastSavedRelPath: saved.lastSavedRelPath,
			userEdits: saved.userEdits,
			newProblemsMessage: saved.newProblemsMessage,
		},
	}
}

describe("pushToolWriteResult (the tool_result text after a file write)", () => {
	it("reports a created file with the two baseline notices and nothing else", async () => {
		const task = makeTask({ lastSavedRelPath: "src/new.ts" })

		const text = await pushToolWriteResult(task, true)

		expect(text).toBe(
			'{"path":"src/new.ts","operation":"created","notice":"You do not need to re-read the file, as you have seen all changes Proceed with the task using these changes as the new baseline."}',
		)
		expect(task.say).not.toHaveBeenCalled()
	})

	it("reports a modified file with the new problems appended", async () => {
		const task = makeTask({
			lastSavedRelPath: "src/app.ts",
			newProblemsMessage:
				"\n\nNew problems detected after saving the file:\nsrc/app.ts\n- [ts Error] 3 | x : oops",
		})

		const text = await pushToolWriteResult(task, false)

		expect(text).toBe(
			'{"path":"src/app.ts","operation":"modified","notice":"You do not need to re-read the file, as you have seen all changes Proceed with the task using these changes as the new baseline.","problems":"\\n\\nNew problems detected after saving the file:\\nsrc/app.ts\\n- [ts Error] 3 | x : oops"}',
		)
		expect(task.say).not.toHaveBeenCalled()
	})

	it("reports user edits: third notice, user_edits field, and a user_feedback_diff row for the UI", async () => {
		const userEdits = "@@ -1,1 +1,1 @@\n-a\n+b\n"
		const task = makeTask({
			lastSavedRelPath: "src/app.ts",
			userEdits,
			newProblemsMessage: "PROBLEMS",
		})

		const text = await pushToolWriteResult(task, false)

		expect(text).toBe(
			'{"path":"src/app.ts","operation":"modified","notice":"You do not need to re-read the file, as you have seen all changes Proceed with the task using these changes as the new baseline. If the user\'s edits have addressed part of the task or changed the requirements, adjust your approach accordingly.","user_edits":"@@ -1,1 +1,1 @@\\n-a\\n+b\\n","problems":"PROBLEMS"}',
		)
		expect(task.say).toHaveBeenCalledTimes(1)
		expect(task.say).toHaveBeenCalledWith(
			"user_feedback_diff",
			'{"tool":"editedExistingFile","path":"src/app.ts","diff":"@@ -1,1 +1,1 @@\\n-a\\n+b\\n"}',
		)
	})

	it("labels the user_feedback_diff row of a new file as newFileCreated", async () => {
		const task = makeTask({ lastSavedRelPath: "src/new.ts", userEdits: "EDITS" })

		const text = await pushToolWriteResult(task, true)

		expect(JSON.parse(text)).toMatchObject({ operation: "created", user_edits: "EDITS" })
		expect(task.say).toHaveBeenCalledWith(
			"user_feedback_diff",
			'{"tool":"newFileCreated","path":"src/new.ts","diff":"EDITS"}',
		)
	})

	it("omits an empty problems message", async () => {
		const task = makeTask({ lastSavedRelPath: "a.txt", newProblemsMessage: "" })

		expect(JSON.parse(await pushToolWriteResult(task, false))).not.toHaveProperty("problems")
	})

	it("throws when nothing was saved yet", async () => {
		await expect(pushToolWriteResult(makeTask(), false)).rejects.toThrow(
			"No file path available in DiffViewProvider",
		)
	})
})
