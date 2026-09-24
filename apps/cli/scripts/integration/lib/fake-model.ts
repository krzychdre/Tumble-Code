/**
 * The scripted model the integration cases run against.
 *
 * run.ts points ROO_CLI_FAKE_AI_MODULE at this file, so the CLI hands it to
 * the extension on the hidden `fake-ai` provider (src/api/providers/fake-ai.ts)
 * instead of calling a real model. The cases test the stdin stream protocol
 * (start, message, cancel, queueing, shutdown), not model quality, so the
 * model only has to answer the cases' prompts the same way every time:
 *
 * - "Run exactly this command ...: <command>. After it finishes, ..." runs
 *   <command> with execute_command, and the command's result is answered
 *   with attempt_completion("done").
 * - 'reply with only "X"', 'reply with exactly "X"' or 'Respond with exactly
 *   X' completes with X.
 * - Anything else completes with "OK".
 *
 * Only the newest user turn is read (its text and its tool results), so the
 * model never answers an older prompt twice.
 */

// The extension's own Anthropic SDK types are not a dependency of the CLI;
// these are the parts of a message this model reads.
interface TextBlock {
	type: "text"
	text: string
}

interface ToolResultBlock {
	type: "tool_result"
	content?: string | TextBlock[]
}

type ContentBlock = TextBlock | ToolResultBlock | { type: string }

interface MessageParam {
	role: "user" | "assistant"
	content: string | ContentBlock[]
}

type Chunk =
	| { type: "text"; text: string }
	| { type: "tool_call_partial"; index: number; id?: string; name?: string; arguments?: string }
	| { type: "finish_reason"; finishReason: string }
	| { type: "usage"; inputTokens: number; outputTokens: number }

const COMMAND_PATTERN = /Run exactly this command[^:]*:\s*(.+?)\.\s+After it finishes/
const ANSWER_PATTERNS = [
	/reply with (?:only|exactly) "([^"]+)"/i,
	/reply with only ([\w-]+)/i,
	/respond with exactly ([\w-]+)/i,
]

let callCounter = 0

function textOf(content: string | ContentBlock[] | undefined): string[] {
	if (content === undefined) {
		return []
	}

	if (typeof content === "string") {
		return [content]
	}

	return content.flatMap((block) => {
		if (block.type === "text") {
			return [(block as TextBlock).text]
		}

		// An answer to the completion question arrives inside the
		// attempt_completion result, as <user_message>...</user_message>.
		if (block.type === "tool_result") {
			return textOf((block as ToolResultBlock).content)
		}

		return []
	})
}

/** The newest user turn's words, without the environment details the extension appends. */
function userTextOf(message: MessageParam): string {
	return textOf(message.content)
		.filter((text) => !text.trimStart().startsWith("<environment_details>"))
		.join("\n")
}

function hasToolResult(message: MessageParam): boolean {
	return typeof message.content !== "string" && message.content.some((block) => block.type === "tool_result")
}

type Reply = { tool: "execute_command"; command: string } | { tool: "attempt_completion"; result: string }

/** What the model does next, from the newest user turn. */
function decideReply(messages: MessageParam[]): Reply {
	const lastUser = [...messages].reverse().find((message) => message.role === "user")

	if (!lastUser) {
		return { tool: "attempt_completion", result: "OK" }
	}

	// A command's result comes back as a tool result whose output matches
	// none of the patterns, which ends the task with "done".
	const text = userTextOf(lastUser)

	const command = COMMAND_PATTERN.exec(text)?.[1]
	if (command) {
		return { tool: "execute_command", command }
	}

	for (const pattern of ANSWER_PATTERNS) {
		const answer = pattern.exec(text)?.[1]
		if (answer) {
			return { tool: "attempt_completion", result: answer }
		}
	}

	return { tool: "attempt_completion", result: hasToolResult(lastUser) ? "done" : "OK" }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const fakeModel = {
	id: "cli-integration-scripted-model",

	async *createMessage(_systemPrompt: string, messages: MessageParam[]): AsyncGenerator<Chunk> {
		const reply = decideReply(messages)
		callCounter += 1

		// A little streamed text first, so the cases that react to the first
		// assistant chunk (followup-during-streaming) see one before the tool.
		const preface = reply.tool === "execute_command" ? "Running the command." : "Answering."
		for (const word of preface.split(" ")) {
			yield { type: "text", text: `${word} ` }
			await sleep(20)
		}

		const args =
			reply.tool === "execute_command"
				? { command: reply.command, cwd: null, timeout: null }
				: { result: reply.result }

		yield {
			type: "tool_call_partial",
			index: 0,
			id: `call_${callCounter}`,
			name: reply.tool,
			arguments: JSON.stringify(args),
		}
		yield { type: "finish_reason", finishReason: "tool_calls" }
		yield { type: "usage", inputTokens: 100, outputTokens: 10 }
	},

	getModel() {
		return {
			id: "cli-integration-scripted-model",
			info: {
				maxTokens: 4096,
				contextWindow: 128_000,
				supportsImages: true,
				supportsPromptCache: false,
				inputPrice: 0,
				outputPrice: 0,
			},
		}
	},

	async countTokens(): Promise<number> {
		return 100
	},

	async completePrompt(): Promise<string> {
		return "OK"
	},
}

export default fakeModel
