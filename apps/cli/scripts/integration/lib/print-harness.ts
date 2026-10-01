import path from "path"
import { fileURLToPath } from "url"

import { execa } from "execa"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defaultCliRoot = path.resolve(__dirname, "../../..")

/**
 * The provider flags every case runs with. They only have to pass the CLI's
 * own checks: run.ts sets ROO_CLI_FAKE_AI_MODULE, so the extension runs on
 * the scripted model in fake-model.ts instead, with no network or real key.
 */
const PROVIDER_ARGS = ["--provider", "anthropic", "--api-key", "unused-by-the-scripted-model"]

export interface PrintRunResult {
	exitCode: number | undefined
	stdout: string
	stderr: string
}

/**
 * Run the CLI from source in print mode with the given arguments and wait for
 * it to exit. tsx is started directly rather than through `pnpm dev`, so the
 * timeout's signal reaches the CLI itself.
 */
export async function runPrint(args: string[], timeoutMs = 120_000): Promise<PrintRunResult> {
	const cliRoot = process.env.ROO_CLI_ROOT ? path.resolve(process.env.ROO_CLI_ROOT) : defaultCliRoot

	const result = await execa("tsx", ["src/index.ts", "--print", ...PROVIDER_ARGS, ...args], {
		cwd: cliRoot,
		stdin: "ignore",
		reject: false,
		timeout: timeoutMs,
		forceKillAfterDelay: 2_000,
	})

	if (result.timedOut) {
		throw new Error(`CLI did not exit within ${timeoutMs} ms\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
	}

	return { exitCode: result.exitCode, stdout: String(result.stdout), stderr: String(result.stderr) }
}

/** The JSON events of a stream-json run, one per stdout line; other lines are skipped. */
export function parseStreamEvents(stdout: string): Array<Record<string, unknown>> {
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("{"))
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as Record<string, unknown>]
			} catch {
				return []
			}
		})
}

/** Fail the case with the run's output attached, so CI shows what the CLI printed. */
export function assertRun(condition: unknown, message: string, run: PrintRunResult): asserts condition {
	if (!condition) {
		throw new Error(`${message}\nexit code: ${run.exitCode}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`)
	}
}
