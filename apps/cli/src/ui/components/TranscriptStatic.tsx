import { Box, Static, Text } from "ink"

import type { StaticItem } from "../transcript.js"

import ChatHistoryItem from "./ChatHistoryItem.js"
import WelcomeBanner from "./WelcomeBanner.js"

interface TranscriptStaticProps {
	items: StaticItem[]
	/** Terminal width; every printed row must fit in it. */
	columns: number
}

/**
 * The promoted transcript: ink's `<Static>` region, printed once into native
 * scrollback and never rewritten.
 *
 * The explicit width matters (plan: 2026-09-22 cli static rows overflow
 * width). Ink lays `<Static>` out as an absolutely positioned box, which is
 * not bounded by the terminal width, so a markdown paragraph made of nested
 * `Text` nodes (plain text, code, links) was wrapped one or two columns wider
 * than the terminal. The terminal then wrapped the last character onto a row
 * of its own ("8," alone under a paragraph). The dynamic tail never had the
 * problem because it sits in the normal flow of the root, which ink sizes to
 * the terminal.
 */
export default function TranscriptStatic({ items, columns }: TranscriptStaticProps) {
	return (
		<Static items={items} style={{ width: columns }}>
			{(item) => {
				if (item.kind === "welcome") {
					return (
						<Box key={item.id}>
							<WelcomeBanner {...item.welcomeProps} />
						</Box>
					)
				}
				if (item.kind === "divider") {
					return (
						<Box key={item.id} marginTop={1}>
							<Text dimColor>{item.label}</Text>
						</Box>
					)
				}
				return (
					<Box key={item.id}>
						<ChatHistoryItem message={item.message} expanded={item.expanded} />
					</Box>
				)
			}}
		</Static>
	)
}
