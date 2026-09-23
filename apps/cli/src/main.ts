import { Command } from "commander"

import { DEFAULT_FLAGS, REASONING_EFFORTS } from "@/types/constants.js"
import { VERSION } from "@/lib/utils/version.js"
import {
	run,
	login,
	logout,
	status,
	loginToOpenAiCodex,
	logoutFromOpenAiCodex,
	getOpenAiCodexAuthStatus,
	listCommands,
	listModes,
	listModels,
	listSessions,
	upgrade,
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
	.option("-p, --print", "Print response and exit (non-interactive mode)", false)
	.option(
		"--stdin-prompt-stream",
		"Read NDJSON commands from stdin (requires --print and --output-format stream-json)",
		false,
	)
	.option(
		"--signal-only-exit",
		"Do not exit from normal completion/errors; only terminate on SIGINT/SIGTERM (intended for stdin stream harnesses)",
		false,
	)
	.option("-e, --extension <path>", "Path to the extension bundle directory")
	.option("-d, --debug", "Enable debug output (includes detailed debug information)", false)
	.option("-a, --require-approval", "Require manual approval for actions", false)
	.option("-k, --api-key <key>", "API key for the LLM provider")
	.option("--provider <provider>", "API provider (anthropic, openrouter, ollama, etc.)")
	.option("-m, --model <model>", "Model to use (defaults to the persisted/settings model, then the built-in default)")
	.option("--base-url <url>", "Base URL override for the selected provider")
	.option(
		"--mode <mode>",
		`Mode to start in (code, architect, ask, debug, etc.; defaults to the settings mode, then ${DEFAULT_FLAGS.mode})`,
	)
	.option("--terminal-shell <path>", "Absolute path to shell executable for inline terminal commands")
	.option(
		"-r, --reasoning-effort <effort>",
		`Reasoning effort level (${REASONING_EFFORTS.join(", ")}; defaults to the settings value, then ${DEFAULT_FLAGS.reasoningEffort})`,
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
	.description("List commands, modes, models, or sessions")
	.enablePositionalOptions()
	.passThroughOptions()

const applyListOptions = (command: Command) =>
	command
		.option("-w, --workspace <path>", "Workspace directory path (defaults to current working directory)")
		.option("-e, --extension <path>", "Path to the extension bundle directory")
		.option("-k, --api-key <key>", "Tumble API key (falls back to saved login/session token)")
		.option("--format <format>", 'Output format: "json" (default) or "text"', "json")
		.option("-d, --debug", "Enable debug output", false)

const runListAction = async (action: () => Promise<void>) => {
	try {
		await action()
		process.exit(0)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		console.error(`[CLI] Error: ${message}`)
		process.exit(1)
	}
}

const runUpgradeAction = async (action: () => Promise<void>) => {
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
		await runListAction(() => listCommands(options))
	},
)

applyListOptions(listCommand.command("modes").description("List available modes")).action(
	async (options: Parameters<typeof listModes>[0]) => {
		await runListAction(() => listModes(options))
	},
)

applyListOptions(listCommand.command("models").description("List available Tumble models")).action(
	async (options: Parameters<typeof listModels>[0]) => {
		await runListAction(() => listModels(options))
	},
)

applyListOptions(listCommand.command("sessions").description("List task sessions")).action(
	async (options: Parameters<typeof listSessions>[0]) => {
		await runListAction(() => listSessions(options))
	},
)

program
	.command("upgrade")
	.description("Upgrade Tumble Code CLI to the latest version")
	.action(async () => {
		await runUpgradeAction(() => upgrade())
	})

const authCommand = program.command("auth").description("Manage Tumble Cloud and provider authentication")

authCommand
	.command("login")
	.description("Authenticate with Tumble Code Cloud")
	.option("-v, --verbose", "Enable verbose output", false)
	.action(async (options: { verbose: boolean }) => {
		const result = await login({ verbose: options.verbose })
		process.exit(result.success ? 0 : 1)
	})

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

authCommand
	.command("logout")
	.description("Log out from Tumble Code Cloud")
	.option("-v, --verbose", "Enable verbose output", false)
	.action(async (options: { verbose: boolean }) => {
		const result = await logout({ verbose: options.verbose })
		process.exit(result.success ? 0 : 1)
	})

authCommand
	.command("status")
	.description("Show authentication status")
	.option("-v, --verbose", "Enable verbose output", false)
	.action(async (options: { verbose: boolean }) => {
		const result = await status({ verbose: options.verbose })
		process.exit(result.authenticated ? 0 : 1)
	})

program.parse()
