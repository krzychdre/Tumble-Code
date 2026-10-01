import { assertRun, runPrint } from "../lib/print-harness"

type Event = { type?: string; subtype?: string; id?: number; done?: boolean; tool_result?: { output?: string } }

// A json run in which the model runs a shell command: the single JSON object
// lists the execute_command tool use and its output under the same id, and the
// task then completes.
async function main() {
	const run = await runPrint([
		"--output-format",
		"json",
		"Run exactly this command: echo cli-integration-output. After it finishes, report back.",
	])

	assertRun(run.exitCode === 0, "the CLI did not exit 0", run)

	let output: { type?: string; success?: boolean; events?: Event[] }
	try {
		output = JSON.parse(run.stdout.slice(run.stdout.indexOf("{")))
	} catch {
		assertRun(false, "stdout is not one JSON object", run)
	}

	assertRun(output.type === "result" && output.success === true, "the task did not complete successfully", run)

	const events = output.events ?? []
	const toolUse = events.find((event) => event.type === "tool_use" && event.subtype === "command")
	assertRun(toolUse?.id !== undefined, "no execute_command tool_use event", run)

	const results = events.filter((event) => event.type === "tool_result" && event.subtype === "command")
	assertRun(
		results.some((event) => event.id === toolUse!.id && event.done === true),
		"no finished command output under the tool use's id",
		run,
	)
	assertRun(
		results.some((event) => event.tool_result?.output?.includes("cli-integration-output")),
		"the command's output is missing",
		run,
	)
}

main().catch((error) => {
	console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`)
	process.exit(1)
})
