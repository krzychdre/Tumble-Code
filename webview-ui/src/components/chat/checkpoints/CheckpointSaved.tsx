import { useMemo, useRef, useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

import { CheckpointMenu } from "./CheckpointMenu"
import { checkpointSchema } from "./schema"
import { GitCommitVertical } from "lucide-react"

type CheckpointSavedProps = {
	ts: number
	commitHash: string
	currentHash?: string
	checkpoint?: Record<string, unknown>
	onJumpToPreviousCheckpoint?: () => void
}

export const CheckpointSaved = ({
	checkpoint,
	currentHash,
	onJumpToPreviousCheckpoint,
	...props
}: CheckpointSavedProps) => {
	const { t } = useTranslation()
	const isCurrent = currentHash === props.commitHash
	const [isPopoverOpen, setIsPopoverOpen] = useState(false)
	const [isClosing, setIsClosing] = useState(false)
	const [isHovering, setIsHovering] = useState(false)
	const closeTimer = useRef<number | null>(null)

	useEffect(() => {
		return () => {
			if (closeTimer.current) {
				window.clearTimeout(closeTimer.current)
				closeTimer.current = null
			}
		}
	}, [])

	const handlePopoverOpenChange = (open: boolean) => {
		setIsPopoverOpen(open)
		if (open) {
			setIsClosing(false)
			if (closeTimer.current) {
				window.clearTimeout(closeTimer.current)
				closeTimer.current = null
			}
		} else {
			setIsClosing(true)
			closeTimer.current = window.setTimeout(() => {
				setIsClosing(false)
				closeTimer.current = null
			}, 200) // keep menu visible briefly to avoid popover jump
		}
	}

	const handleMouseEnter = () => {
		setIsHovering(true)
	}

	const handleMouseLeave = () => {
		setIsHovering(false)
	}

	// Menu is visible when hovering, popover is open, or briefly after popover closes
	const menuVisible = isHovering || isPopoverOpen || isClosing

	const metadata = useMemo(() => {
		if (!checkpoint) {
			return undefined
		}

		const result = checkpointSchema.safeParse(checkpoint)

		if (!result.success) {
			return undefined
		}

		return result.data
	}, [checkpoint])

	if (!metadata) {
		return null
	}

	return (
		<div
			className="flex items-center justify-between gap-2 pt-2 pb-3"
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}>
			<div className="flex items-center gap-2 text-vscode-descriptionForeground whitespace-nowrap">
				<GitCommitVertical className="w-4 text-vscode-charts-blue" />
				<span>{t("chat:checkpoint.regular")}</span>
				{isCurrent && <span>({t("chat:checkpoint.current")})</span>}
			</div>
			{/* A 1px rule in the theme blue (it was a hard-coded cyan gradient). */}
			<span
				aria-hidden="true"
				className="block w-full h-px bg-[color-mix(in_srgb,var(--vscode-charts-blue)_45%,transparent)]"></span>

			{/* Keep menu visible while hovering, popover is open, or briefly after close to prevent jump */}
			<div data-testid="checkpoint-menu-container" className={cn("h-4 -mt-2", menuVisible ? "block" : "hidden")}>
				<CheckpointMenu
					ts={props.ts}
					commitHash={props.commitHash}
					checkpoint={metadata}
					onOpenChange={handlePopoverOpenChange}
					onJumpToPreviousCheckpoint={onJumpToPreviousCheckpoint}
				/>
			</div>
		</div>
	)
}
