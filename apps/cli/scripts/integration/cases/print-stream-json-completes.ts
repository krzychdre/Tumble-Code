import { assertRun, parseStreamEvents, runPrint } from "../lib/print-harness"

// A plain print run with stream-json output: the init event comes first, the
// prompt is echoed as a user event, and the run ends with one successful
// result event that carries the model's answer and the task's cost.
async function main() {
	const run = await runPrint(["--output-format", "stream-json", 'Please reply with exactly "PONG".'])
	const events = parseStreamEvents(run.stdout)

	assertRun(run.exitCode === 0, "the CLI did not exit 0", run)
	assertRun(events[0]?.type === "system" && events[0]?.subtype === "init", "the first event is not system:init", run)
	assertRun(
		events.some((event) => event.type === "user" && event.done === true),
		"the prompt was not echoed as a user event",
		run,
	)

	const results = events.filter((event) => event.type === "result")
	assertRun(results.length === 1, `expected one result event, got ${results.length}`, run)
	assertRun(results[0]!.success === true, "the result event is not successful", run)
	assertRun(results[0]!.content === "PONG", `unexpected result content: ${String(results[0]!.content)}`, run)
	assertRun(typeof results[0]!.cost === "object", "the result event carries no cost", run)
}

main().catch((error) => {
	console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`)
	process.exit(1)
})
