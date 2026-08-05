import { memo, useEffect, useState } from "react"
import { Box, Text } from "ink"

import { figures } from "../../figures.js"
import * as theme from "../../theme.js"

export type BulletStatus = "running" | "success" | "error" | "plain"

interface Props {
	status?: BulletStatus
	dim?: boolean
}

/**
 * Status bullet column for message/tool rows.
 * "running" bullets blink by toggling dimColor on a 600ms interval;
 * the interval is cleared on unmount.
 */
function Bullet({ status = "plain", dim = false }: Props) {
	const [blinkOn, setBlinkOn] = useState(false)

	useEffect(() => {
		if (status !== "running") {
			return
		}
		const timer = setInterval(() => setBlinkOn((on) => !on), 600)
		return () => clearInterval(timer)
	}, [status])

	const dimColor = dim || (status === "running" && !blinkOn)

	let color: string | undefined
	switch (status) {
		case "success":
			color = theme.success
			break
		case "error":
			color = theme.error
			break
		case "plain":
			color = theme.text
			break
		case "running":
			color = undefined // default color, dimmed while blinking
			break
	}

	return (
		<Box minWidth={2}>
			<Text dimColor={dimColor} color={color}>
				{figures.bullet}
			</Text>
		</Box>
	)
}

export default memo(Bullet)
