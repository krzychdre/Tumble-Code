import { reasoningEffortsExtended } from "@roo-code/types"

export const DEFAULT_FLAGS = {
	mode: "code",
	reasoningEffort: "medium" as const,
	model: "anthropic/claude-opus-4.6",
	provider: "openrouter" as const,
	consecutiveMistakeLimit: 10,
	/** Seconds a shell command may run before it is stopped (0: no limit). */
	commandExecutionTimeout: 300,
}

/**
 * Longest command execution timeout, in seconds. Node's setTimeout takes at
 * most 2^31-1 ms and fires after 1 ms for anything longer, so a larger value
 * would stop every command at once.
 */
export const MAX_COMMAND_EXECUTION_TIMEOUT_SECONDS = Math.floor((2 ** 31 - 1) / 1000)

export const REASONING_EFFORTS = [...reasoningEffortsExtended, "unspecified", "disabled"]

/**
 * Default timeout in seconds for auto-approving followup questions.
 * Used in both the TUI (App.tsx) and the extension host (extension-host.ts).
 */
export const FOLLOWUP_TIMEOUT_SECONDS = 60

export const ASCII_ROO = `  _,'   ___
 <__\\__/   \\
    \\_  /  _\\
      \\,\\ / \\\\
        //   \\\\
      ,/'     \`\\_,`

export const AUTH_BASE_URL = process.env.ROO_AUTH_BASE_URL ?? "http://localhost:3000"

export const SDK_BASE_URL = process.env.ROO_SDK_BASE_URL ?? "http://localhost:3001"
