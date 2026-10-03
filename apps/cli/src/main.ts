import { Command } from "commander"

import { DEFAULT_FLAGS, REASONING_EFFORTS } from "@/types/constants.js"
import { VERSION } from "@/lib/utils/version.js"
import {
	run,
	loginToOpenAiCodex,
	logoutFromOpenAiCodex,
	getOpenAiCodexAuthStatus,
	loginToCloud,
	logoutFromCloud,
	getCloudAuthStatus,
	listCommands,
	listModes,
	listSessions,
	upgrade,
	doctor,
} from "@/commands/index.js"

const program = new Command()

program
	.name("tumble")
	.description(
		"Tumble Code CLI - starts an interactive session by default, use -p/--print for non-interactive output",
	)
	.version(VERSION)
	.enablePositionalOptions()
	.passThroughOptions()

program
	.argument("[prompt]", "Your prompt")
	.option("--prompt-file <path>", "Read prompt from a file instead of command line argument")
	.option("--create-with-session-id <session-id>", "Create a new task with a specific session ID (must be a UUID)")
	.option("--session-id <session-id>", "Resume a specific task by session ID")
	.option("-c, --continue", "Resume the most recent task in the current workspace", false)
	.option("-w, --workspace <path>", "Workspace directory path (defaults to current working directory)")
	.option("--resume", "Start with a picker of this workspace's earlier tasks to resume", false)
	.option("-p, --print", "Print response and exit (non-interactive mode)", false)
	.option("-e, --extension <path>", "Path to the extension bundle directory")
	.option("-d, --debug", "Enable debug output (includes detailed debug information)", false)
	.option("-a, --require-approval", "Require manual approval for actions", false)
	.option("-k, --api-key <key>", "API key for the LLM provider")
	.option("--provider <provider>", "API provider (anthropic, openrouter, ollama, etc.)")
	.option(
		"-m, --model <model>",
		"Model to use (defaults to the persisted/settings model, then the provider's default model)",
	)
	.option("--base-url <url>", "Base URL override for the selected provider")
	.option(
		"--mode <mode>",
		`Mode to start in (code, architect, ask, debug, etc.; defaults to the settings mode, then ${DEFAULT_FLAGS.mode})`,
	)
	.option("--terminal-shell <path>", "Absolute path to shell executable for inline terminal commands")
	.option(
		"-r, --reasoning-effort <effort>",
		`Reasoning effort level (${REASONING_EFFORTS.join(", ")}; defaults to the settings value, then ${DEFAULT_FLAGS.reasoningEffort}, or unspecified for the openai provider)`,
	)
	.option(
		"--consecutive-mistake-limit <limit>",
		"Consecutive error/repetition limit before guidance prompt (0 disables the limit)",
		(value) => Number.parseInt(value, 10),
	)
	.option(
		"--command-execution-timeout <seconds>",
		`Seconds a shell command may run before it is stopped (0 means no limit; defaults to the settings value, then ${DEFAULT_FLAGS.commandExecutionTimeout})`,
	)
	.option("--exit-on-error", "Exit on API request errors instead of retrying", false)
	.option("--ephemeral", "Run without persisting state (uses temporary storage)", false)
	.option("--oneshot", "Exit upon task completion", false)
	.option(
		"--output-format <format>",
		'Output format (only works with --print): "text" (default), "json" (single result), or "stream-json" (realtime streaming)',
		"text",
	)
	.action(run)

const listCommand = program
	.command("list")
	.description("List commands, modes, or sessions")
	.enablePositionalOptions()
	.passThroughOptions()

const applyListOptions = (command: Command) =>
	command
		.option("-w, --workspace <path>", "Workspace directory path (defaults to current working directory)")
		.option("-e, --extension <path>", "Path to the extension bundle directory")
		.option("-k, --api-key <key>", "Anthropic API key for the extension the listing starts (not needed to list)")
		.option("--format <format>", 'Output format: "json" (default) or "text"', "json")
		.option("-d, --debug", "Enable debug output", false)

// Runs a one-shot subcommand: exit 0 when it finishes, else print the error and exit 1.
const runAndExit = async (action: () => Promise<void>) => {
	try {
		await action()
		process.exit(0)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		console.error(`[CLI] Error: ${message}`)
		process.exit(1)
	}
}

applyListOptions(listCommand.command("commands").description("List available slash commands")).action(
	async (options: Parameters<typeof listCommands>[0]) => {
		await runAndExit(() => listCommands(options))
	},
)

applyListOptions(listCommand.command("modes").description("List available modes")).action(
	async (options: Parameters<typeof listModes>[0]) => {
		await runAndExit(() => listModes(options))
	},
)

applyListOptions(listCommand.command("sessions").description("List task sessions")).action(
	async (options: Parameters<typeof listSessions>[0]) => {
		await runAndExit(() => listSessions(options))
	},
)

program
	.command("upgrade")
	.description("Upgrade Tumble Code CLI to the latest version")
	.action(async () => {
		await runAndExit(() => upgrade())
	})

program
	.command("doctor")
	.description("Check the extension bundle, ripgrep, Node.js, the MCP config and the cloud connection")
	.option("-e, --extension <path>", "Path to the extension bundle directory")
	.action(async (options: { extension?: string }) => {
		process.exit(await doctor(options))
	})

const authCommand = program.command("auth").description("Manage provider and cloud authentication")

const codexAuthCommand = authCommand.command("codex").description("Manage ChatGPT subscription access for OpenAI Codex")

codexAuthCommand
	.command("login")
	.description("Sign in to OpenAI Codex with ChatGPT Plus, Pro, Team, or Enterprise")
	.action(async () => {
		const result = await loginToOpenAiCodex()
		process.exit(result.success ? 0 : 1)
	})

codexAuthCommand
	.command("logout")
	.description("Remove the stored OpenAI Codex OAuth credentials")
	.action(async () => {
		const result = await logoutFromOpenAiCodex()
		process.exit(result.success ? 0 : 1)
	})

codexAuthCommand
	.command("status")
	.description("Show OpenAI Codex OAuth status")
	.action(async () => {
		const result = await getOpenAiCodexAuthStatus()
		process.exit(result.authenticated ? 0 : 1)
	})

const cloudAuthCommand = authCommand
	.command("cloud")
	.description("Manage the Tumble Code Cloud sign-in (set cloudApiUrl in ~/.roo/cli-settings.json first)")

cloudAuthCommand
	.command("login")
	.description("Sign in to Tumble Code Cloud in the browser; signed-in runs send usage telemetry to it")
	.action(async () => {
		const result = await loginToCloud()
		process.exit(result.success ? 0 : 1)
	})

cloudAuthCommand
	.command("logout")
	.description("Sign out from Tumble Code Cloud and remove the stored credentials")
	.action(async () => {
		const result = await logoutFromCloud()
		process.exit(result.success ? 0 : 1)
	})

cloudAuthCommand
	.command("status")
	.description("Show whether the CLI is signed in to Tumble Code Cloud, as whom, and which cloud")
	.action(async () => {
		const result = await getCloudAuthStatus()
		process.exit(result.authenticated ? 0 : 1)
	})

program.parse()
