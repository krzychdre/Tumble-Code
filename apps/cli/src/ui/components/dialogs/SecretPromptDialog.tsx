import { memo, useEffect, useRef, useState } from "react"
import { Box, Text, useInput } from "ink"

import * as theme from "../../theme.js"
import type { SecretPrompt } from "../../stores/secretPromptStore.js"

export interface SecretPromptDialogProps {
	/** The question the blocked command is waiting on. */
	prompt: SecretPrompt
	/** Called with what the user typed. */
	onSubmit: (value: string) => void
	/** Called when the user presses esc, which lets the command fail. */
	onCancel: () => void
	/** When false, the dialog ignores all input (default true). */
	isActive?: boolean
}

/**
 * Asks the user a question that a running command is blocked on, typically for
 * a password or a key passphrase.
 *
 * The text is masked unless the question is not about a secret, which is how
 * ssh's "continue connecting (yes/no)?" stays readable while it is typed.
 *
 * What is typed here never leaves this dialog except through `onSubmit`, which
 * hands it to the waiting command. It is not added to the transcript.
 */
function SecretPromptDialog({ prompt, onSubmit, onCancel, isActive = true }: SecretPromptDialogProps) {
	// The typed answer lives in a ref, with state kept alongside it only to
	// trigger a redraw. Reading `value` from state inside the handler below is
	// not safe: ink re-registers the handler in an effect, so a keypress that
	// arrives before that effect has run sees the previous render's value. Under
	// load that turned a typed password into an empty one on enter.
	const valueRef = useRef("")
	const [value, setValue] = useState("")

	const update = (next: string) => {
		valueRef.current = next
		setValue(next)
	}

	// A second question (git asks for the username, then the password) reuses
	// this component, so the previous answer must not be left in the box.
	useEffect(() => update(""), [prompt.id])

	useInput(
		(input, key) => {
			if (key.escape) {
				onCancel()
				return
			}

			if (key.return) {
				onSubmit(valueRef.current)
				return
			}

			if (key.backspace || key.delete) {
				update(valueRef.current.slice(0, -1))
				return
			}

			// Ctrl+U, the terminal's own "clear the line", which people reach for
			// when they mistype a password they cannot see.
			if (key.ctrl && input === "u") {
				update("")
				return
			}

			if (key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow) {
				return
			}

			if (input) {
				update(valueRef.current + input)
			}
		},
		{ isActive },
	)

	const shown = prompt.masked ? "•".repeat(value.length) : value

	return (
		<Box borderStyle="round" borderColor={theme.permission} paddingX={1} flexDirection="column">
			{prompt.title && <Text dimColor>{prompt.title}</Text>}
			<Text bold color={theme.permission}>
				{prompt.prompt}
			</Text>
			<Text>
				{"> "}
				{shown}
				<Text color={theme.subtle}>▋</Text>
			</Text>
			<Text dimColor>
				{prompt.masked ? "Typing is hidden. " : ""}
				enter to answer, esc to refuse
			</Text>
		</Box>
	)
}

export default memo(SecretPromptDialog)
