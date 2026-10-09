import React, { useState, useMemo } from "react"
import { Check, CheckCheck, ChevronUp, X } from "lucide-react"
import { cn } from "../../lib/utils"
import { useTranslation } from "react-i18next"
import { StandardTooltip } from "../ui/standard-tooltip"
import { Input } from "../ui/input"

interface CommandPattern {
	pattern: string
	description?: string
}

interface CommandPatternSelectorProps {
	patterns: CommandPattern[]
	allowedCommands: string[]
	deniedCommands: string[]
	onAllowPatternChange: (pattern: string) => void
	onDenyPatternChange: (pattern: string) => void
}

export const CommandPatternSelector: React.FC<CommandPatternSelectorProps> = ({
	patterns,
	allowedCommands,
	deniedCommands,
	onAllowPatternChange,
	onDenyPatternChange,
}) => {
	const { t } = useTranslation()
	const [isExpanded, setIsExpanded] = useState(false)
	const [editingStates, setEditingStates] = useState<Record<string, { isEditing: boolean; value: string }>>({})

	// Create a combined list with full command first, then patterns
	const allPatterns = useMemo(() => {
		// Create a set to track unique patterns we've already seen
		const seenPatterns = new Set<string>()

		// Filter out any patterns that are duplicates or are the same as the full command
		const uniquePatterns = patterns.filter((p) => {
			if (seenPatterns.has(p.pattern)) {
				return false
			}
			seenPatterns.add(p.pattern)
			return true
		})

		return uniquePatterns
	}, [patterns])

	const getPatternStatus = (pattern: string): "allowed" | "denied" | "none" => {
		if (allowedCommands.includes(pattern)) return "allowed"
		if (deniedCommands.includes(pattern)) return "denied"
		return "none"
	}

	const getEditState = (pattern: string) => {
		return editingStates[pattern] || { isEditing: false, value: pattern }
	}

	const setEditState = (pattern: string, isEditing: boolean, value?: string) => {
		setEditingStates((prev) => ({
			...prev,
			[pattern]: { isEditing, value: value ?? pattern },
		}))
	}

	return (
		<div className="border-t border-frame">
			<button
				onClick={() => setIsExpanded(!isExpanded)}
				className="w-full min-h-[28px] px-2 py-1 flex items-center justify-between text-vscode-descriptionForeground hover:text-vscode-foreground hover:bg-surface-hover transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-vscode-focusBorder">
				<div className="group flex items-center gap-2 cursor-pointer w-full text-left">
					<span
						className={cn("text-sm flex-1", isExpanded && "text-vscode-foreground")}>
						<CheckCheck className="size-3 inline-block mr-2" />
						{t("chat:commandExecution.manageCommands")}
					</span>
					<ChevronUp
						className={cn("size-4 transition-transform", !isExpanded && "-rotate-180")}
					/>
				</div>
			</button>

			{isExpanded && (
				<div className="pl-6 pr-2 pt-1 pb-2 space-y-2">
					{allPatterns.map((item) => {
						const editState = getEditState(item.pattern)
						const status = getPatternStatus(editState.value)

						return (
							<div key={item.pattern} className="flex items-center gap-2">
								<div className="flex-1">
									{editState.isEditing ? (
										<Input
											type="text"
											value={editState.value}
											onChange={(e) => setEditState(item.pattern, true, e.target.value)}
											onBlur={() => setEditState(item.pattern, false)}
											onKeyDown={(e) => {
												if (e.key === "Enter") {
													setEditState(item.pattern, false)
												}
												if (e.key === "Escape") {
													setEditState(item.pattern, false, item.pattern)
												}
											}}
											className="h-[26px] font-mono text-xs border-input-frame px-2"
											placeholder={item.pattern}
											autoFocus
										/>
									) : (
										<div
											onClick={() => setEditState(item.pattern, true)}
											className="font-mono text-xs text-vscode-foreground cursor-pointer hover:bg-surface-hover px-2 py-1.5 transition-colors border border-transparent rounded-control break-all"
											title={t("chat:commandExecution.clickToEditPattern")}>
											<span className="break-all">{editState.value}</span>
											{item.description && (
												<span className="text-vscode-descriptionForeground ml-2">
													- {item.description}
												</span>
											)}
										</div>
									)}
								</div>
								<div className="flex items-center gap-1">
									<StandardTooltip
										content={t(
											status === "allowed"
												? "chat:commandExecution.removeFromAllowed"
												: "chat:commandExecution.addToAllowed",
										)}>
										<button
											className={cn("p-1 transition-all cursor-pointer rounded-control focus-ring", {
												"bg-vscode-charts-green/20 text-vscode-charts-green hover:bg-vscode-charts-green/30":
													status === "allowed",
												"text-vscode-descriptionForeground hover:text-vscode-charts-green hover:bg-vscode-charts-green/10":
													status !== "allowed",
											})}
											onClick={() => onAllowPatternChange(editState.value)}
											aria-label={t(
												status === "allowed"
													? "chat:commandExecution.removeFromAllowed"
													: "chat:commandExecution.addToAllowed",
											)}>
											<Check className="size-3.5" />
										</button>
									</StandardTooltip>
									<StandardTooltip
										content={t(
											status === "denied"
												? "chat:commandExecution.removeFromDenied"
												: "chat:commandExecution.addToDenied",
										)}>
										<button
											className={cn("p-1 transition-all cursor-pointer rounded-control focus-ring", {
												"bg-vscode-errorForeground/20 text-vscode-errorForeground hover:bg-vscode-errorForeground/30":
													status === "denied",
												"text-vscode-descriptionForeground hover:text-vscode-errorForeground hover:bg-vscode-errorForeground/10":
													status !== "denied",
											})}
											onClick={() => onDenyPatternChange(editState.value)}
											aria-label={t(
												status === "denied"
													? "chat:commandExecution.removeFromDenied"
													: "chat:commandExecution.addToDenied",
											)}>
											<X className="size-3.5" />
										</button>
									</StandardTooltip>
								</div>
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}
