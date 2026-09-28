import { useState } from "react"

import {
	type DescriptorFormProviderId,
	type ModelInfo,
	type ProviderCheckboxFieldDescriptor,
	type ProviderFieldDescriptor,
	type ProviderModelTierSelectFieldDescriptor,
	type ProviderOptionalUrlFieldDescriptor,
	type ProviderSelectFieldDescriptor,
	type ProviderSettings,
	type ProviderUrlFieldDescriptor,
	PROVIDER_DESCRIPTORS,
	matchesProviderModelRule,
	providerApiKeyFields,
	resolveProviderFormModelId,
	resolveProviderGetKeyUrl,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	StandardTooltip,
	ThemedDropdown,
	ThemedOption,
	ThemedTextField,
} from "@src/components/ui"
import { LabeledCheckbox } from "@src/components/ui/labeled-checkbox"

import { ApiKeyField, type ProviderFormProps, useProviderField } from "./shared"

/**
 * The settings form of every provider whose `PROVIDER_DESCRIPTORS` row lists its fields
 * (packages/types/src/provider-descriptors.ts). A provider that needs more than the field kinds
 * there (API key, endpoint choice, URL, optional base URL, checkbox, a choice among the selected
 * model's tiers, each optionally shown only for some models) keeps a hand-written component next
 * to this one.
 */
export const ProviderDescriptorForm = ({
	provider,
	apiConfiguration,
	setApiConfigurationField,
	selectedModelInfo,
}: ProviderFormProps & {
	provider: DescriptorFormProviderId
	/** The selected model's info as the settings resolve it (`useSelectedModel`); feeds `modelTierSelect`. */
	selectedModelInfo?: ModelInfo
}) => {
	const modelId = resolveProviderFormModelId(provider, apiConfiguration)
	// Widened to the field union: a row's literal type only lists the kinds that row uses.
	const fields: readonly ProviderFieldDescriptor[] = PROVIDER_DESCRIPTORS[provider].form.fields

	return (
		<>
			{fields.map((field, index) => {
				if (field.visibleWhen && !matchesProviderModelRule(field.visibleWhen, modelId)) {
					return null
				}

				switch (field.kind) {
					case "apiKey":
						return (
							<ApiKeyField
								key={field.kind}
								apiConfiguration={apiConfiguration}
								setApiConfigurationField={setApiConfigurationField}
								field={providerApiKeyFields[provider]}
								labelKey={field.labelKey}
								getKeyUrl={resolveProviderGetKeyUrl(field.getKeyUrl, apiConfiguration)}
								getKeyLabelKey={field.getKeyLabelKey}
								// Below another field the trio sits in its own group (see ApiKeyField),
								// unless the row keeps the form flat.
								grouped={index > 0 && field.grouped !== false}
							/>
						)
					case "select":
						return (
							<SelectField
								key={field.key}
								field={field}
								apiConfiguration={apiConfiguration}
								setApiConfigurationField={setApiConfigurationField}
							/>
						)
					case "optionalUrl":
						return (
							<OptionalUrlField
								key={field.key}
								field={field}
								apiConfiguration={apiConfiguration}
								setApiConfigurationField={setApiConfigurationField}
							/>
						)
					case "url":
						return (
							<UrlField
								key={field.key}
								field={field}
								apiConfiguration={apiConfiguration}
								setApiConfigurationField={setApiConfigurationField}
							/>
						)
					case "checkbox":
						return (
							<CheckboxField
								key={field.key}
								field={field}
								apiConfiguration={apiConfiguration}
								setApiConfigurationField={setApiConfigurationField}
							/>
						)
					case "modelTierSelect":
						return (
							<ModelTierSelectField
								key={field.key}
								field={field}
								apiConfiguration={apiConfiguration}
								setApiConfigurationField={setApiConfigurationField}
								selectedModelInfo={selectedModelInfo}
							/>
						)
				}
			})}
		</>
	)
}

const SelectField = ({
	field,
	apiConfiguration,
	setApiConfigurationField,
}: ProviderFormProps & { field: ProviderSelectFieldDescriptor }) => {
	const { t } = useAppTranslation()
	const handleInputChange = useProviderField(setApiConfigurationField)

	return (
		<div>
			<label className="block font-medium mb-1">{t(field.labelKey)}</label>
			<ThemedDropdown
				value={apiConfiguration[field.key] || field.defaultValue}
				onChange={handleInputChange(field.key)}
				className="w-full">
				{field.options.map((option) => (
					<ThemedOption key={option.value} value={option.value} className="p-2">
						{option.label}
					</ThemedOption>
				))}
			</ThemedDropdown>
			{field.descriptionKey && (
				<div className="text-xs text-vscode-descriptionForeground mt-1">{t(field.descriptionKey)}</div>
			)}
		</div>
	)
}

const UrlField = ({
	field,
	apiConfiguration,
	setApiConfigurationField,
}: ProviderFormProps & { field: ProviderUrlFieldDescriptor }) => {
	const { t } = useAppTranslation()
	const handleInputChange = useProviderField(setApiConfigurationField)

	return (
		<>
			<ThemedTextField
				value={apiConfiguration[field.key] || ""}
				type="url"
				onInput={handleInputChange(field.key)}
				placeholder={field.placeholder}
				className="w-full">
				<label className="block font-medium mb-1">{t(field.labelKey)}</label>
			</ThemedTextField>
			{field.descriptionKey && (
				// The negative margin compensates for the form's flex gap, as under the API key.
				<div className="text-sm text-vscode-descriptionForeground -mt-2">{t(field.descriptionKey)}</div>
			)}
		</>
	)
}

const CheckboxField = ({
	field,
	apiConfiguration,
	setApiConfigurationField,
}: ProviderFormProps & { field: ProviderCheckboxFieldDescriptor }) => {
	const { t } = useAppTranslation()

	return (
		<div>
			<LabeledCheckbox
				checked={apiConfiguration[field.key] ?? false}
				onCheckedChange={(checked: boolean) => setApiConfigurationField(field.key, checked)}>
				{t(field.labelKey)}
			</LabeledCheckbox>
			{field.descriptionKey && (
				<div className="text-sm text-vscode-descriptionForeground mt-1 ml-6">{t(field.descriptionKey)}</div>
			)}
		</div>
	)
}

const OptionalUrlField = ({
	field,
	apiConfiguration,
	setApiConfigurationField,
}: ProviderFormProps & { field: ProviderOptionalUrlFieldDescriptor }) => {
	const { t } = useAppTranslation()
	const handleInputChange = useProviderField(setApiConfigurationField)
	const [selected, setSelected] = useState(!!apiConfiguration[field.key])

	const controls = (
		<>
			<LabeledCheckbox
				data-testid={field.toggleTestId}
				checked={selected}
				onCheckedChange={(checked: boolean) => {
					setSelected(checked)
					if (!checked) {
						setApiConfigurationField(field.key, "")
						for (const [key, value] of Object.entries(field.alsoClear ?? {})) {
							setApiConfigurationField(key as keyof ProviderSettings, value)
						}
					}
				}}>
				{t(field.toggleLabelKey)}
			</LabeledCheckbox>
			{selected && (
				<>
					<ThemedTextField
						value={apiConfiguration[field.key] || ""}
						type="url"
						onInput={handleInputChange(field.key)}
						placeholder={field.placeholderKey ? t(field.placeholderKey) : field.placeholder}
						className="w-full mt-1"
					/>
					{field.revealedFields?.map((revealed) => (
						<LabeledCheckbox
							key={revealed.key}
							checked={apiConfiguration[revealed.key] ?? false}
							onCheckedChange={(checked: boolean) => setApiConfigurationField(revealed.key, checked)}
							className="w-full mt-1">
							{t(revealed.labelKey)}
						</LabeledCheckbox>
					))}
				</>
			)}
		</>
	)

	return field.grouped === false ? controls : <div>{controls}</div>
}

const ModelTierSelectField = ({
	field,
	apiConfiguration,
	setApiConfigurationField,
	selectedModelInfo,
}: ProviderFormProps & { field: ProviderModelTierSelectFieldDescriptor; selectedModelInfo?: ModelInfo }) => {
	const { t } = useAppTranslation()
	const tierNames = new Set(selectedModelInfo?.tiers?.map((tier) => tier.name))
	const options = field.options.filter((option) => tierNames.has(option.value))

	if (options.length === 0) {
		return null
	}

	return (
		<div className="flex flex-col gap-1 mt-2" data-testid={field.testId}>
			<div className="flex items-center gap-1">
				<label className="block font-medium mb-1">{t(field.labelKey)}</label>
				{field.tooltipKey && (
					<StandardTooltip content={t(field.tooltipKey)}>
						<i className="codicon codicon-info text-vscode-descriptionForeground text-xs" />
					</StandardTooltip>
				)}
			</div>

			<Select
				value={apiConfiguration[field.key] || field.baseOption.value}
				onValueChange={(value) =>
					setApiConfigurationField(field.key, value as ProviderSettings[typeof field.key])
				}>
				<SelectTrigger className="w-full">
					<SelectValue placeholder={t("settings:common.select")} />
				</SelectTrigger>
				<SelectContent>
					{[field.baseOption, ...options].map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{t(option.labelKey)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	)
}
