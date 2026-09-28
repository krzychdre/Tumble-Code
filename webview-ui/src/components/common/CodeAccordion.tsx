import { memo, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { ThemedProgressRing } from "@src/components/ui"
import { type ToolProgressStatus } from "@roo-code/types"
import { getLanguageFromPath } from "@src/utils/getLanguageFromPath"
import { formatPathTooltip } from "@src/utils/formatPathTooltip"
import { parseUnifiedDiff } from "@src/utils/parseUnifiedDiff"
import { countDiffStats } from "@src/utils/diffFolds"
import { vscode } from "@src/utils/vscode"

import { ToolUseBlock, ToolUseBlockHeader } from "./ToolUseBlock"
import CodeBlock from "./CodeBlock"
import { PathTooltip } from "../ui/PathTooltip"
import DiffView from "./DiffView"

interface CodeAccordionProps {
	path?: string
	code?: string
	language: string
	progressStatus?: ToolProgressStatus
	isLoading?: boolean
	isExpanded: boolean
	isFeedback?: boolean
	onToggleExpand: () => void
	header?: string
	onJumpToFile?: () => void
	// New props for diff stats
	diffStats?: { added: number; removed: number }
}

const CodeAccordion = ({
	path,
	code = "",
	language,
	progressStatus,
	isLoading,
	isExpanded,
	isFeedback,
	onToggleExpand,
	header,
	onJumpToFile,
	diffStats,
}: CodeAccordionProps) => {
	const { t } = useTranslation()
	const inferredLanguage = useMemo(() => language ?? (path ? getLanguageFromPath(path) : "txt"), [path, language])
	const source = useMemo(() => code.trim(), [code])
	const hasHeader = Boolean(path || isFeedback || header)

	const isDiff = inferredLanguage === "diff"

	// §2.7: the file header always shows "+N -M" for a diff. The payload's stats
	// win; without them (user edits, older history) they are counted from the diff.
	const derivedStats = useMemo(() => {
		if (diffStats && (diffStats.added > 0 || diffStats.removed > 0)) return diffStats
		if (isDiff && source) return countDiffStats(parseUnifiedDiff(source, path))
		return null
	}, [diffStats, isDiff, source, path])

	const hasValidStats = Boolean(derivedStats && (derivedStats.added > 0 || derivedStats.removed > 0))

	return (
		// overflow-visible: an overflow-hidden block would become the sticky header's
		// scroll box and pin nothing.
		<ToolUseBlock className="overflow-visible">
			{hasHeader && (
				<ToolUseBlockHeader
					onClick={onToggleExpand}
					data-testid="code-accordion-header"
					className="group sticky top-0 z-10 bg-vscode-editor-background">
					{isLoading && <ThemedProgressRing className="size-3 mr-2" />}
					{header ? (
						<div className="flex items-center">
							<span className="codicon codicon-server mr-1.5"></span>
							<PathTooltip content={header}>
								<span className="whitespace-nowrap overflow-hidden text-ellipsis mr-2">{header}</span>
							</PathTooltip>
						</div>
					) : isFeedback ? (
						<div className="flex items-center">
							<span className={`codicon codicon-${isFeedback ? "feedback" : "codicon-output"} mr-1.5`} />
							<span className="whitespace-nowrap overflow-hidden text-ellipsis mr-2 rtl">
								{isFeedback ? "User Edits" : "Console Logs"}
							</span>
						</div>
					) : (
						<>
							{path?.startsWith(".") && <span>.</span>}
							<PathTooltip content={formatPathTooltip(path)}>
								<span className="whitespace-nowrap overflow-hidden text-ellipsis text-left mr-2 rtl">
									{formatPathTooltip(path)}
								</span>
							</PathTooltip>
						</>
					)}
					<div className="flex-grow-1" />
					{/* Prefer diff stats over generic progress indicator if available */}
					{hasValidStats ? (
						<div className="flex items-center gap-2 mr-1">
							<span className="text-xs font-medium text-vscode-charts-green">+{derivedStats!.added}</span>
							<span className="text-xs font-medium text-vscode-charts-red">-{derivedStats!.removed}</span>
						</div>
					) : (
						progressStatus &&
						progressStatus.text && (
							<>
								{progressStatus.icon && (
									<span className={`codicon codicon-${progressStatus.icon} mr-1`} />
								)}
								<span className="mr-1 ml-auto text-vscode-descriptionForeground">
									{progressStatus.text}
								</span>
							</>
						)
					)}
					{isDiff && source && (
						<button
							type="button"
							className="flex items-center mr-1 p-0 cursor-pointer bg-transparent border-none text-vscode-descriptionForeground hover:text-vscode-foreground focus-ring"
							title={t("chat:diffView.openDiff")}
							aria-label={t("chat:diffView.openDiff")}
							onClick={(e) => {
								e.stopPropagation()
								vscode.postMessage({ type: "openDiff", text: source })
							}}>
							<span className="codicon codicon-diff" aria-hidden="true" />
						</button>
					)}
					{onJumpToFile && path && (
						<button
							type="button"
							className="flex items-center mr-1 p-0 cursor-pointer bg-transparent border-none text-vscode-descriptionForeground hover:text-vscode-foreground focus-ring"
							title={t("chat:diffView.openFile")}
							aria-label={t("chat:diffView.openFile")}
							onClick={(e) => {
								e.stopPropagation()
								onJumpToFile()
							}}>
							<span className="codicon codicon-link-external" aria-hidden="true" />
						</button>
					)}
					{!onJumpToFile && (
						<span
							className={`opacity-60 group-hover:opacity-100 codicon codicon-chevron-${isExpanded ? "up" : "down"}`}
							aria-hidden="true"></span>
					)}
				</ToolUseBlockHeader>
			)}
			{(!hasHeader || isExpanded) && (
				<div className="overflow-x-auto overflow-y-auto max-h-[300px] max-w-full">
					{isDiff ? (
						<DiffView source={source} filePath={path} />
					) : (
						<CodeBlock source={source} language={inferredLanguage} />
					)}
				</div>
			)}
		</ToolUseBlock>
	)
}

export default memo(CodeAccordion)
