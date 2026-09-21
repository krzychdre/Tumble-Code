import { memo } from "react"
import { Box, Text } from "ink"

import { figures } from "../figures.js"
import * as theme from "../theme.js"

export interface WelcomeBannerProps {
	/** Absolute workspace path — shortened with ~ for the home prefix */
	workspacePath: string
	/** Logged-in user, if any — renders a "Welcome back, {name}" line */
	user?: { name?: string } | null
	/** Provider id (e.g. "openai") */
	provider: string
	/** Model id (e.g. "gpt-5") */
	model: string
	/** Active mode slug (e.g. "code") */
	mode: string
	/** Reasoning effort, if configured (e.g. "high") */
	reasoningEffort?: string
	/** YOLO / non-interactive mode marker */
	nonInteractive?: boolean
	/** CLI version, shown dim after the welcome line */
	version: string
}

/**
 * Shorten an absolute path by replacing the home directory prefix with `~`.
 * Falls back to USERPROFILE on Windows. Returns the path unchanged if no
 * home prefix matches.
 */
function shortenPath(p: string): string {
	const home = process.env.HOME || process.env.USERPROFILE
	if (home && home.length > 0 && (p === home || p.startsWith(home + "/") || p.startsWith(home + "\\"))) {
		return "~" + p.substring(home.length)
	}
	return p
}

/**
 * One-liner welcome banner (Claude Code style §2).
 *
 *   ✻ Welcome to Tumble Code v0.1.17
 *
 *     cwd: ~/Projekty/QUB-IT/Roo-Code
 *     openai · gpt-5 [high] · mode: code (YOLO)
 *
 * No giant ASCII mascot — the welcome prints once as the first `<Static>`
 * item and scrolls away naturally as the conversation grows.
 */
function WelcomeBanner({
	workspacePath,
	user,
	provider,
	model,
	mode,
	reasoningEffort,
	nonInteractive = false,
	version,
}: WelcomeBannerProps) {
	const shortened = shortenPath(workspacePath)
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Box>
				<Text color={theme.brand}>{figures.welcome} Welcome to Tumble Code </Text>
				<Text dimColor>v{version}</Text>
			</Box>
			<Box paddingLeft={2} flexDirection="column">
				{user?.name && <Text dimColor>Welcome back, {user.name}</Text>}
				<Text dimColor>cwd: {shortened}</Text>
				<Text dimColor>
					{provider} · {model}
					{reasoningEffort ? ` [${reasoningEffort}]` : ""} · mode: {mode}
					{nonInteractive ? " (YOLO)" : ""}
				</Text>
			</Box>
		</Box>
	)
}

export default memo(WelcomeBanner)
