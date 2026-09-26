import React, { useState } from "react"
import { VSCodeRadioGroup, VSCodeRadio, VSCodeTextArea, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { type GroupEntry, type McpServer, type ModeConfig, modeConfigSchema } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, Input, LabeledCheckbox } from "@src/components/ui"
import McpServerChecklist from "@src/components/modes/McpServerChecklist"

import { availableGroups, getGroupName } from "./modeGroups"

type ModeSource = "global" | "project"

/** The fields whose schema errors are shown under their input. */
type ErrorField = "name" | "slug" | "description" | "roleDefinition" | "groups"

const ERROR_FIELDS: readonly string[] = ["name", "slug", "description", "roleDefinition", "groups"]

const DEFAULT_NAME = "New Custom Mode"

/** Lowercase, dashes for anything else, no leading or trailing dash. */
function generateSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "")
}

/** "New Custom Mode", or "New Custom Mode 2", 3, ... when the name or its slug is taken. */
function firstFreeDefault(modes: readonly ModeConfig[]): { name: string; slug: string } {
	let attempt = 0
	let name = DEFAULT_NAME
	let slug = generateSlug(name)
	while (modes.some((m) => m.slug === slug || m.name === name)) {
		attempt++
		name = `${DEFAULT_NAME} ${attempt + 1}`
		slug = generateSlug(name)
	}
	return { name, slug }
}

type CreateModeDialogProps = {
	/** Every mode, used to prefill a name and slug that are still free. */
	modes: readonly ModeConfig[]
	mcpServers: McpServer[]
	/** Called with a mode that passed schema validation. */
	onCreate: (mode: ModeConfig) => void
	onClose: () => void
}

/**
 * The "Create New Mode" side panel. Mount it only while it is open: every mount starts
 * from a fresh form prefilled with the first free default name.
 */
export function CreateModeDialog({ modes, mcpServers, onCreate, onClose }: CreateModeDialogProps) {
	const { t } = useAppTranslation()

	const [defaults] = useState(() => firstFreeDefault(modes))
	const [name, setName] = useState(defaults.name)
	const [slug, setSlug] = useState(defaults.slug)
	const [description, setDescription] = useState("")
	const [roleDefinition, setRoleDefinition] = useState("")
	const [whenToUse, setWhenToUse] = useState("")
	const [customInstructions, setCustomInstructions] = useState("")
	const [groups, setGroups] = useState<GroupEntry[]>(availableGroups)
	const [source, setSource] = useState<ModeSource>("global")
	const [allowedMcpServers, setAllowedMcpServers] = useState<string[] | undefined>(undefined)
	const [errors, setErrors] = useState<Partial<Record<ErrorField, string>>>({})

	const handleNameChange = (value: string) => {
		setName(value)
		setSlug(generateSlug(value))
	}

	const handleCreate = () => {
		const newMode: ModeConfig = {
			slug,
			name,
			description: description.trim() || undefined,
			roleDefinition: roleDefinition.trim(),
			whenToUse: whenToUse.trim() || undefined,
			customInstructions: customInstructions.trim() || undefined,
			groups,
			source,
			allowedMcpServers,
		}

		const result = modeConfigSchema.safeParse(newMode)
		if (!result.success) {
			const nextErrors: Partial<Record<ErrorField, string>> = {}
			for (const error of result.error.issues) {
				const field = String(error.path[0])
				if (ERROR_FIELDS.includes(field)) {
					nextErrors[field as ErrorField] = error.message
				}
			}
			setErrors(nextErrors)
			return
		}

		setErrors({})
		onCreate(newMode)
	}

	const fieldError = (field: ErrorField) =>
		errors[field] ? <div className="text-xs text-vscode-errorForeground mt-1">{errors[field]}</div> : null

	return (
		<div className="fixed inset-0 flex justify-end bg-black/50 z-[1000]">
			<div className="w-[calc(100vw-100px)] h-full bg-vscode-editor-background shadow-md flex flex-col relative">
				<div className="flex-1 p-5 overflow-y-auto min-h-0">
					<Button variant="ghost" size="icon" onClick={onClose} className="absolute top-5 right-5">
						<span className="codicon codicon-close"></span>
					</Button>
					<h2 className="mb-4">{t("prompts:createModeDialog.title")}</h2>
					<div className="mb-4">
						<div className="font-bold mb-1">{t("prompts:createModeDialog.name.label")}</div>
						<Input
							type="text"
							value={name}
							onChange={(e) => handleNameChange(e.target.value)}
							className="w-full"
						/>
						{fieldError("name")}
					</div>
					<div className="mb-4">
						<div className="font-bold mb-1">{t("prompts:createModeDialog.slug.label")}</div>
						<Input type="text" value={slug} onChange={(e) => setSlug(e.target.value)} className="w-full" />
						<div className="text-xs text-vscode-descriptionForeground mt-1">
							{t("prompts:createModeDialog.slug.description")}
						</div>
						{fieldError("slug")}
					</div>
					<div className="mb-4">
						<div className="font-bold mb-1">{t("prompts:createModeDialog.saveLocation.label")}</div>
						<div className="text-sm text-vscode-descriptionForeground mb-2">
							{t("prompts:createModeDialog.saveLocation.description")}
						</div>
						<VSCodeRadioGroup
							value={source}
							onChange={(e: Event | React.FormEvent<HTMLElement>) => {
								const target = ((e as CustomEvent)?.detail?.target ||
									(e.target as HTMLInputElement)) as HTMLInputElement
								setSource(target.value as ModeSource)
							}}>
							<VSCodeRadio value="global">
								{t("prompts:createModeDialog.saveLocation.global.label")}
								<div className="text-xs text-vscode-descriptionForeground mt-0.5">
									{t("prompts:createModeDialog.saveLocation.global.description")}
								</div>
							</VSCodeRadio>
							<VSCodeRadio value="project">
								{t("prompts:createModeDialog.saveLocation.project.label")}
								<div className="text-xs text-vscode-descriptionForeground mt-0.5">
									{t("prompts:createModeDialog.saveLocation.project.description")}
								</div>
							</VSCodeRadio>
						</VSCodeRadioGroup>
					</div>

					<div className="mb-4">
						<div className="font-bold mb-1">{t("prompts:createModeDialog.roleDefinition.label")}</div>
						<div className="text-[13px] text-vscode-descriptionForeground mb-2">
							{t("prompts:createModeDialog.roleDefinition.description")}
						</div>
						<VSCodeTextArea
							resize="vertical"
							value={roleDefinition}
							onChange={(e) => setRoleDefinition((e.target as HTMLTextAreaElement).value)}
							rows={4}
							className="w-full"
						/>
						{fieldError("roleDefinition")}
					</div>

					<div className="mb-4">
						<div className="font-bold mb-1">{t("prompts:createModeDialog.description.label")}</div>
						<div className="text-[13px] text-vscode-descriptionForeground mb-2">
							{t("prompts:createModeDialog.description.description")}
						</div>
						<VSCodeTextField
							value={description}
							onChange={(e) => setDescription((e.target as HTMLInputElement).value)}
							className="w-full"
						/>
						{fieldError("description")}
					</div>

					<div className="mb-4">
						<div className="font-bold mb-1">{t("prompts:createModeDialog.whenToUse.label")}</div>
						<div className="text-[13px] text-vscode-descriptionForeground mb-2">
							{t("prompts:createModeDialog.whenToUse.description")}
						</div>
						<VSCodeTextArea
							resize="vertical"
							value={whenToUse}
							onChange={(e) => setWhenToUse((e.target as HTMLTextAreaElement).value)}
							rows={3}
							className="w-full"
						/>
					</div>
					<div className="mb-4">
						<div className="font-bold mb-1">{t("prompts:createModeDialog.tools.label")}</div>
						<div className="text-[13px] text-vscode-descriptionForeground mb-2">
							{t("prompts:createModeDialog.tools.description")}
						</div>
						<div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
							{availableGroups.map((group) => (
								<LabeledCheckbox
									key={group}
									checked={groups.some((g) => getGroupName(g) === group)}
									onChange={(e: Event | React.FormEvent<HTMLElement>) => {
										const target =
											(e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
										if (target.checked) {
											setGroups([...groups, group])
										} else {
											setGroups(groups.filter((g) => getGroupName(g) !== group))
										}
									}}>
									{t(`prompts:tools.toolNames.${group}`)}
								</LabeledCheckbox>
							))}
						</div>
						{fieldError("groups")}
						{groups.some((g) => getGroupName(g) === "mcp") && (
							<div className="mt-3 ml-1" data-testid="create-mcp-server-restriction">
								<LabeledCheckbox
									checked={allowedMcpServers !== undefined}
									data-testid="create-restrict-mcp-servers-toggle"
									onChange={(e: Event | React.FormEvent<HTMLElement>) => {
										const target =
											(e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
										setAllowedMcpServers(target.checked ? [] : undefined)
									}}>
									Restrict to specific MCP servers
								</LabeledCheckbox>
								{allowedMcpServers !== undefined && (
									<McpServerChecklist
										allowedMcpServers={allowedMcpServers}
										mcpServers={mcpServers}
										testIdPrefix="create-mcp-server"
										onServerToggle={(serverName) => (e) => {
											const target =
												(e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
											const checked = target.checked
											setAllowedMcpServers((prev) => {
												const current = prev ?? []
												return checked
													? current.includes(serverName)
														? current
														: [...current, serverName]
													: current.filter((s) => s !== serverName)
											})
										}}
									/>
								)}
							</div>
						)}
					</div>
					<div className="mb-4">
						<div className="font-bold mb-1">{t("prompts:createModeDialog.customInstructions.label")}</div>
						<div className="text-[13px] text-vscode-descriptionForeground mb-2">
							{t("prompts:createModeDialog.customInstructions.description")}
						</div>
						<VSCodeTextArea
							resize="vertical"
							value={customInstructions}
							onChange={(e) => setCustomInstructions((e.target as HTMLTextAreaElement).value)}
							rows={4}
							className="w-full"
						/>
					</div>
				</div>
				<div className="flex justify-end p-3 px-5 gap-2 border-t border-vscode-editor-lineHighlightBorder bg-vscode-editor-background">
					<Button variant="secondary" onClick={onClose}>
						{t("prompts:createModeDialog.buttons.cancel")}
					</Button>
					<Button variant="primary" onClick={handleCreate}>
						{t("prompts:createModeDialog.buttons.create")}
					</Button>
				</div>
			</div>
		</div>
	)
}
