import { Box, Text } from "ink"

import * as theme from "../../theme.js"
import Bullet from "../primitives/Bullet.js"
import ResultRow from "../primitives/ResultRow.js"

import type { ToolRendererProps } from "./types.js"
import { toolStatusFromMessage } from "./types.js"

export function ModeTool({ toolData, message }: ToolRendererProps) {
	const status = toolStatusFromMessage(message)
	const mode = toolData.mode || ""
	const reason = toolData.reason || ""

	return (
		<Box flexDirection="column">
			<Box>
				<Bullet status={status} />
				<Box flexDirection="column" flexGrow={1}>
					<Text wrap="truncate-end">
						<Text bold>Switch Mode</Text>
						{mode ? <Text>(</Text> : null}
						{mode ? <Text color={theme.planMode}>{mode}</Text> : null}
						{mode ? <Text>)</Text> : null}
					</Text>
					{mode && <ResultRow maxLines={1}>{`Switching to ${mode} mode`}</ResultRow>}
					{reason && <ResultRow maxLines={3}>{reason}</ResultRow>}
				</Box>
			</Box>
		</Box>
	)
}
