import { useState, useCallback, useEffect, useMemo, type ReactNode } from "react"
import { LabeledCheckbox } from "@src/components/ui/labeled-checkbox"

import {
	type ModelInfo,
	type ReasoningEffort,
	type OrganizationAllowList,
	azureOpenAiDefaultApiVersion,
	openAiModelInfoSaneDefaults,
} from "@tumble-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, StandardTooltip, Input } from "@src/components/ui"
import { useTextDraft } from "@src/components/ui/hooks"
import { useProviderModels } from "@src/hooks/models/useProviderModels"

import { convertHeadersToObject } from "../utils/headers"
import { noTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"
import { R1FormatSetting } from "../R1FormatSetting"
import { ThinkingBudget } from "../ThinkingBudget"
import { type ProviderFormProps, useProviderField } from "./shared"

/** A price label with its info tooltip. */
const PriceLabel = ({ label, description }: { label: string; description: string }) => (
	<span className="flex items-center gap-1 mb-0.5">
		<span className="block font-medium mb-1">{label}</span>
		<StandardTooltip content={description}>
			<i className="codicon codicon-info text-vscode-descriptionForeground text-xs" aria-hidden="true" />
		</StandardTooltip>
	</span>
)

type ModelInfoNumberFieldProps = {
	/** Shown above the field, inside its label. */
	label: ReactNode
	value: string
	placeholder: string
	/** Receives the typed text: on every keystroke, or once when the field is left with `saveOnLeave`. */
	onText: (text: string) => void
	saveOnLeave?: boolean
}

/** A number of the custom model info, typed as text: the typed text stays shown until the stored value changes. */
const ModelInfoNumberField = ({
	label,
	value,
	placeholder,
	onText,
	saveOnLeave = false,
}: ModelInfoNumberFieldProps) => {
	const draft = useTextDraft(value, saveOnLeave ? onText : undefined)
	return (
		<label className="block w-full leading-[normal]">
			{label}
			<Input
				type="text"
				placeholder={placeholder}
				{...draft}
				onChange={(e) => {
					draft.onChange(e)
					if (!saveOnLeave) onText(e.target.value)
				}}
			/>
		</label>
	)
}

type OpenAICompatibleProps = ProviderFormProps & {
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
	simplifySettings?: boolean
}

export const OpenAICompatible = ({
	apiConfiguration,
	setApiConfigurationField,
	organizationAllowList,
	modelValidationError,
	simplifySettings,
}: OpenAICompatibleProps) => {
	const { t } = useAppTranslation()

	const [azureApiVersionSelected, setAzureApiVersionSelected] = useState(!!apiConfiguration?.azureApiVersion)

	const { modelIds: openAiModelIds } = useProviderModels("openai", {
		baseUrl: apiConfiguration.openAiBaseUrl,
		apiKey: apiConfiguration.openAiApiKey,
		headers: apiConfiguration.openAiHeaders,
	})
	const openAiModels = useMemo<Record<string, ModelInfo> | null>(
		() =>
			openAiModelIds
				? Object.fromEntries(openAiModelIds.map((modelId) => [modelId, openAiModelInfoSaneDefaults]))
				: null,
		[openAiModelIds],
	)

	const [customHeaders, setCustomHeaders] = useState<[string, string][]>(() => {
		const headers = apiConfiguration?.openAiHeaders || {}
		return Object.entries(headers)
	})

	const handleAddCustomHeader = useCallback(() => {
		// Only update the local state to show the new row in the UI.
		setCustomHeaders((prev) => [...prev, ["", ""]])
		// Do not update the main configuration yet, wait for user input.
	}, [])

	const handleUpdateHeaderKey = useCallback((index: number, newKey: string) => {
		setCustomHeaders((prev) => {
			const updated = [...prev]

			if (updated[index]) {
				updated[index] = [newKey, updated[index][1]]
			}

			return updated
		})
	}, [])

	const handleUpdateHeaderValue = useCallback((index: number, newValue: string) => {
		setCustomHeaders((prev) => {
			const updated = [...prev]

			if (updated[index]) {
				updated[index] = [updated[index][0], newValue]
			}

			return updated
		})
	}, [])

	const handleRemoveCustomHeader = useCallback((index: number) => {
		setCustomHeaders((prev) => prev.filter((_, i) => i !== index))
	}, [])

	// Helper to convert array of tuples to object

	// Add effect to update the parent component's state when local headers change
	useEffect(() => {
		const timer = setTimeout(() => {
			const headerObject = convertHeadersToObject(customHeaders)
			setApiConfigurationField("openAiHeaders", headerObject, false)
		}, 300)

		return () => clearTimeout(timer)
	}, [customHeaders, setApiConfigurationField])

	const handleInputChange = useProviderField(setApiConfigurationField)

	return (
		<>
			<label className="block w-full leading-[normal]">
				<span className="block font-medium mb-1">{t("settings:providers.openAiBaseUrl")}</span>
				<Input
					value={apiConfiguration?.openAiBaseUrl || ""}
					type="url"
					onChange={handleInputChange("openAiBaseUrl")}
					placeholder={t("settings:placeholders.baseUrl")}
				/>
			</label>
			<label className="block w-full leading-[normal]">
				<span className="block font-medium mb-1">{t("settings:providers.apiKey")}</span>
				<Input
					value={apiConfiguration?.openAiApiKey || ""}
					type="password"
					onChange={handleInputChange("openAiApiKey")}
					placeholder={t("settings:placeholders.apiKey")}
				/>
			</label>
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId="gpt-4o"
				models={openAiModels}
				modelIdKey="openAiModelId"
				serviceName="OpenAI"
				serviceUrl="https://platform.openai.com"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
			/>
			<R1FormatSetting
				onChange={handleInputChange("openAiR1FormatEnabled", noTransform)}
				openAiR1FormatEnabled={apiConfiguration?.openAiR1FormatEnabled ?? false}
			/>
			<LabeledCheckbox
				checked={apiConfiguration?.openAiStreamingEnabled ?? true}
				onCheckedChange={handleInputChange("openAiStreamingEnabled", noTransform)}>
				{t("settings:modelInfo.enableStreaming")}
			</LabeledCheckbox>
			<div>
				<LabeledCheckbox
					checked={apiConfiguration?.includeMaxTokens ?? true}
					onCheckedChange={handleInputChange("includeMaxTokens", noTransform)}>
					{t("settings:includeMaxOutputTokens")}
				</LabeledCheckbox>
				<div className="text-sm text-vscode-descriptionForeground ml-6">
					{t("settings:includeMaxOutputTokensDescription")}
				</div>
			</div>
			<LabeledCheckbox
				checked={apiConfiguration?.openAiUseAzure ?? false}
				onCheckedChange={handleInputChange("openAiUseAzure", noTransform)}>
				{t("settings:modelInfo.useAzure")}
			</LabeledCheckbox>
			<div>
				<LabeledCheckbox
					checked={azureApiVersionSelected}
					onCheckedChange={(checked: boolean) => {
						setAzureApiVersionSelected(checked)

						if (!checked) {
							setApiConfigurationField("azureApiVersion", "")
						}
					}}>
					{t("settings:modelInfo.azureApiVersion")}
				</LabeledCheckbox>
				{azureApiVersionSelected && (
					<Input
						value={apiConfiguration?.azureApiVersion || ""}
						onChange={handleInputChange("azureApiVersion")}
						placeholder={`Default: ${azureOpenAiDefaultApiVersion}`}
						className="w-full mt-1"
					/>
				)}
			</div>

			{/* Custom Headers UI */}
			<div className="mb-4">
				<div className="flex justify-between items-center mb-2">
					<label className="block font-medium">{t("settings:providers.customHeaders")}</label>
					<StandardTooltip content={t("settings:common.add")}>
						<Button aria-label={t("settings:common.add")} variant="icon" onClick={handleAddCustomHeader}>
							<span className="codicon codicon-add"></span>
						</Button>
					</StandardTooltip>
				</div>
				{!customHeaders.length ? (
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.noCustomHeaders")}
					</div>
				) : (
					customHeaders.map(([key, value], index) => (
						<div key={index} className="flex items-center mb-2">
							<Input
								value={key}
								className="flex-1 mr-2"
								placeholder={t("settings:providers.headerName")}
								onChange={(e) => handleUpdateHeaderKey(index, e.target.value)}
							/>
							<Input
								value={value}
								className="flex-1 mr-2"
								placeholder={t("settings:providers.headerValue")}
								onChange={(e) => handleUpdateHeaderValue(index, e.target.value)}
							/>
							<StandardTooltip content={t("settings:common.remove")}>
								<Button
									aria-label={t("settings:common.remove")}
									variant="icon"
									onClick={() => handleRemoveCustomHeader(index)}>
									<span className="codicon codicon-trash"></span>
								</Button>
							</StandardTooltip>
						</div>
					))
				)}
			</div>

			<div className="flex flex-col gap-1">
				<LabeledCheckbox
					checked={apiConfiguration.enableReasoningEffort ?? false}
					onCheckedChange={(checked: boolean) => {
						setApiConfigurationField("enableReasoningEffort", checked)

						if (!checked) {
							const { reasoningEffort: _, ...openAiCustomModelInfo } =
								apiConfiguration.openAiCustomModelInfo || openAiModelInfoSaneDefaults

							setApiConfigurationField("openAiCustomModelInfo", openAiCustomModelInfo)
						}
					}}>
					{t("settings:providers.setReasoningLevel")}
				</LabeledCheckbox>
				{!!apiConfiguration.enableReasoningEffort && (
					<ThinkingBudget
						apiConfiguration={{
							...apiConfiguration,
							reasoningEffort: apiConfiguration.openAiCustomModelInfo?.reasoningEffort,
						}}
						setApiConfigurationField={(field, value) => {
							if (field === "reasoningEffort") {
								const openAiCustomModelInfo =
									apiConfiguration.openAiCustomModelInfo || openAiModelInfoSaneDefaults

								setApiConfigurationField("openAiCustomModelInfo", {
									...openAiCustomModelInfo,
									reasoningEffort: value as ReasoningEffort,
								})
							}
						}}
						modelInfo={{
							...(apiConfiguration.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
							supportsReasoningEffort: ["low", "medium", "high", "xhigh"],
						}}
					/>
				)}
			</div>
			<div className="flex flex-col gap-3">
				<div className="text-sm text-vscode-descriptionForeground whitespace-pre-line">
					{t("settings:providers.customModel.capabilities")}
				</div>

				<div>
					<ModelInfoNumberField
						label={
							<span className="block font-medium mb-1">
								{t("settings:providers.customModel.maxTokens.label")}
							</span>
						}
						value={
							apiConfiguration?.openAiCustomModelInfo?.maxTokens?.toString() ||
							openAiModelInfoSaneDefaults.maxTokens?.toString() ||
							""
						}
						placeholder={t("settings:placeholders.numbers.maxTokens")}
						onText={(text) => {
							const value = parseInt(text)
							setApiConfigurationField("openAiCustomModelInfo", {
								...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
								maxTokens: isNaN(value) ? undefined : value,
							})
						}}
					/>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.customModel.maxTokens.description")}
					</div>
				</div>

				<div>
					<ModelInfoNumberField
						label={
							<span className="block font-medium mb-1">
								{t("settings:providers.customModel.contextWindow.label")}
							</span>
						}
						value={
							apiConfiguration?.openAiCustomModelInfo?.contextWindow?.toString() ||
							openAiModelInfoSaneDefaults.contextWindow?.toString() ||
							""
						}
						placeholder={t("settings:placeholders.numbers.contextWindow")}
						onText={(text) => {
							const parsed = parseInt(text)
							setApiConfigurationField("openAiCustomModelInfo", {
								...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
								contextWindow: isNaN(parsed) ? openAiModelInfoSaneDefaults.contextWindow : parsed,
							})
						}}
					/>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.customModel.contextWindow.description")}
					</div>
				</div>

				<div>
					<div className="flex items-center gap-1">
						<LabeledCheckbox
							checked={
								apiConfiguration?.openAiCustomModelInfo?.supportsImages ??
								openAiModelInfoSaneDefaults.supportsImages
							}
							onCheckedChange={handleInputChange("openAiCustomModelInfo", (checked) => {
								return {
									...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
									supportsImages: checked,
								}
							})}>
							<span className="font-medium">
								{t("settings:providers.customModel.imageSupport.label")}
							</span>
						</LabeledCheckbox>
						<StandardTooltip content={t("settings:providers.customModel.imageSupport.description")}>
							<i
								className="codicon codicon-info text-vscode-descriptionForeground text-xs"
								aria-hidden="true"
							/>
						</StandardTooltip>
					</div>
					<div className="text-sm text-vscode-descriptionForeground pt-1">
						{t("settings:providers.customModel.imageSupport.description")}
					</div>
				</div>

				<div>
					<div className="flex items-center gap-1">
						<LabeledCheckbox
							checked={apiConfiguration?.openAiCustomModelInfo?.supportsPromptCache ?? false}
							onCheckedChange={handleInputChange("openAiCustomModelInfo", (checked) => {
								return {
									...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
									supportsPromptCache: checked,
								}
							})}>
							<span className="font-medium">{t("settings:providers.customModel.promptCache.label")}</span>
						</LabeledCheckbox>
						<StandardTooltip content={t("settings:providers.customModel.promptCache.description")}>
							<i
								className="codicon codicon-info text-vscode-descriptionForeground text-xs"
								aria-hidden="true"
							/>
						</StandardTooltip>
					</div>
					<div className="text-sm text-vscode-descriptionForeground pt-1">
						{t("settings:providers.customModel.promptCache.description")}
					</div>
				</div>

				<div>
					<ModelInfoNumberField
						label={
							<PriceLabel
								label={t("settings:providers.customModel.pricing.input.label")}
								description={t("settings:providers.customModel.pricing.input.description")}
							/>
						}
						value={
							apiConfiguration?.openAiCustomModelInfo?.inputPrice?.toString() ??
							openAiModelInfoSaneDefaults.inputPrice?.toString() ??
							""
						}
						placeholder={t("settings:placeholders.numbers.inputPrice")}
						saveOnLeave
						onText={(text) => {
							const parsed = parseFloat(text)
							setApiConfigurationField("openAiCustomModelInfo", {
								...(apiConfiguration?.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults),
								inputPrice: isNaN(parsed) ? openAiModelInfoSaneDefaults.inputPrice : parsed,
							})
						}}
					/>
				</div>

				<div>
					<ModelInfoNumberField
						label={
							<PriceLabel
								label={t("settings:providers.customModel.pricing.output.label")}
								description={t("settings:providers.customModel.pricing.output.description")}
							/>
						}
						value={
							apiConfiguration?.openAiCustomModelInfo?.outputPrice?.toString() ||
							openAiModelInfoSaneDefaults.outputPrice?.toString() ||
							""
						}
						placeholder={t("settings:placeholders.numbers.outputPrice")}
						saveOnLeave
						onText={(text) => {
							const parsed = parseFloat(text)
							setApiConfigurationField("openAiCustomModelInfo", {
								...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
								outputPrice: isNaN(parsed) ? openAiModelInfoSaneDefaults.outputPrice : parsed,
							})
						}}
					/>
				</div>

				{apiConfiguration?.openAiCustomModelInfo?.supportsPromptCache && (
					<>
						<div>
							<ModelInfoNumberField
								label={
									<PriceLabel
										label={t("settings:providers.customModel.pricing.cacheReads.label")}
										description={t("settings:providers.customModel.pricing.cacheReads.description")}
									/>
								}
								value={apiConfiguration?.openAiCustomModelInfo?.cacheReadsPrice?.toString() ?? "0"}
								placeholder={t("settings:placeholders.numbers.inputPrice")}
								saveOnLeave
								onText={(text) => {
									const parsed = parseFloat(text)
									setApiConfigurationField("openAiCustomModelInfo", {
										...(apiConfiguration?.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults),
										cacheReadsPrice: isNaN(parsed) ? 0 : parsed,
									})
								}}
							/>
						</div>
						<div>
							<ModelInfoNumberField
								label={
									<PriceLabel
										label={t("settings:providers.customModel.pricing.cacheWrites.label")}
										description={t(
											"settings:providers.customModel.pricing.cacheWrites.description",
										)}
									/>
								}
								value={apiConfiguration?.openAiCustomModelInfo?.cacheWritesPrice?.toString() ?? "0"}
								placeholder={t("settings:placeholders.numbers.cacheWritePrice")}
								saveOnLeave
								onText={(text) => {
									const parsed = parseFloat(text)
									setApiConfigurationField("openAiCustomModelInfo", {
										...(apiConfiguration?.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults),
										cacheWritesPrice: isNaN(parsed) ? 0 : parsed,
									})
								}}
							/>
						</div>
					</>
				)}

				<Button
					variant="secondary"
					onClick={() => setApiConfigurationField("openAiCustomModelInfo", openAiModelInfoSaneDefaults)}>
					{t("settings:providers.customModel.resetDefaults")}
				</Button>
			</div>
		</>
	)
}
