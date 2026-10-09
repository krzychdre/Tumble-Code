import { useState, useEffect, useCallback, useMemo } from "react"
import { RefreshCw, FileCode } from "lucide-react"

import type { SerializedCustomToolDefinition } from "@tumble-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"

import { vscode } from "@/utils/vscode"

import { Button, LabeledCheckbox, Spinner } from "@/components/ui"
import { useExtensionMessage } from "@src/utils/extensionBus"
import { cn } from "@/lib/utils"
import { SettingsNested, checkboxDescription } from "./SettingsCard"

interface ToolParameter {
	name: string
	type: string
	description?: string
	required: boolean
}

interface ProcessedTool {
	name: string
	description: string
	parameters: ToolParameter[]
	source?: string
}

interface CustomToolsSettingsProps {
	enabled: boolean
	onChange: (enabled: boolean) => void
}

export const CustomToolsSettings = ({ enabled, onChange }: CustomToolsSettingsProps) => {
	const { t } = useAppTranslation()
	const [tools, setTools] = useState<SerializedCustomToolDefinition[]>([])
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [refreshError, setRefreshError] = useState<string | null>(null)

	useEffect(() => {
		if (enabled) {
			vscode.postMessage({ type: "refreshCustomTools" })
		} else {
			setTools([])
		}
	}, [enabled])

	useExtensionMessage("customToolsResult", (message) => {
		setTools(message.tools || [])
		setIsRefreshing(false)
		setRefreshError(message.error ?? null)
	})

	const onRefresh = useCallback(() => {
		setIsRefreshing(true)
		setRefreshError(null)
		vscode.postMessage({ type: "refreshCustomTools" })
	}, [])

	const processedTools = useMemo<ProcessedTool[]>(
		() =>
			tools.map((tool) => {
				const params = tool.parameters
				const properties = (params?.properties ?? {}) as Record<string, { type?: string; description?: string }>
				const required = (params?.required as string[] | undefined) ?? []

				return {
					name: tool.name,
					description: tool.description,
					source: tool.source,
					parameters: Object.entries(properties).map(([name, def]) => ({
						name,
						type: def.type ?? "any",
						description: def.description,
						required: required.includes(name),
					})),
				}
			}),
		[tools],
	)

	return (
		<div className="flex flex-col">
			<div>
				<div className="flex items-center gap-2">
					<LabeledCheckbox checked={enabled} onChange={(e: any) => onChange(e.target.checked)}>
						<span className="font-medium">{t("settings:experimental.CUSTOM_TOOLS.name")}</span>
					</LabeledCheckbox>
				</div>
				<p className={cn(checkboxDescription, "mb-0")}>
					{t("settings:experimental.CUSTOM_TOOLS.description")}
				</p>
			</div>

			{enabled && (
				<SettingsNested className="mt-block">
					<div className="flex items-center justify-between gap-4">
						<label className="block font-medium">
							{t("settings:experimental.CUSTOM_TOOLS.toolsHeader")}
						</label>
						<Button variant="outline" onClick={onRefresh} disabled={isRefreshing}>
							<div className="flex items-center gap-2">
								{isRefreshing ? <Spinner className="size-4" /> : <RefreshCw className="w-4 h-4" />}
								{isRefreshing
									? t("settings:experimental.CUSTOM_TOOLS.refreshing")
									: t("settings:experimental.CUSTOM_TOOLS.refreshButton")}
							</div>
						</Button>
					</div>

					{refreshError && (
						<div className="p-2 bg-vscode-inputValidation-errorBackground text-vscode-errorForeground text-sm border border-vscode-inputValidation-errorBorder rounded-control">
							{t("settings:experimental.CUSTOM_TOOLS.refreshError")}: {refreshError}
						</div>
					)}

					{processedTools.length === 0 ? (
						<p className="text-vscode-descriptionForeground text-sm italic">
							{t("settings:experimental.CUSTOM_TOOLS.noTools")}
						</p>
					) : (
						processedTools.map((tool) => (
							<div
								key={tool.name}
								className="bg-surface border border-frame rounded-control space-y-3 p-3">
								<div className="space-y-1">
									<div className="font-medium text-vscode-foreground">{tool.name}</div>
									{tool.source && (
										<div className="flex items-center text-xs text-vscode-descriptionForeground">
											<FileCode className="size-3 flex-shrink-0" />
											<span className="font-mono truncate" title={tool.source}>
												{tool.source}
											</span>
										</div>
									)}
								</div>
								<div className="text-vscode-descriptionForeground text-sm">{tool.description}</div>
								{tool.parameters.length > 0 && (
									<div className="space-y-1">
										<div className="text-xs font-medium text-vscode-foreground">
											{t("settings:experimental.CUSTOM_TOOLS.toolParameters")}:
										</div>
										<div>
											{tool.parameters.map((param) => (
												<div
													key={param.name}
													className="flex items-start gap-2 text-xs pl-2 py-1 border-l border-frame-hover">
													<code className="text-vscode-textLink-foreground font-mono">
														{param.name}
													</code>
													<span className="text-vscode-descriptionForeground">
														({param.type})
													</span>
													{param.required && (
														<span className="text-vscode-errorForeground text-[10px] uppercase">
															required
														</span>
													)}
													{param.description && (
														<span className="text-vscode-descriptionForeground">
															- {param.description}
														</span>
													)}
												</div>
											))}
										</div>
									</div>
								)}
							</div>
						))
					)}
				</SettingsNested>
			)}
		</div>
	)
}
