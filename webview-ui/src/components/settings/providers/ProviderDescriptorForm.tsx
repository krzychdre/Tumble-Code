import { useState } from "react"
import { Trans } from "react-i18next"

import {
	type DescriptorFormProviderId,
	type ModelInfo,
	type ModelRecord,
	type ProviderCheckboxFieldDescriptor,
	type ProviderDescriptor,
	type ProviderFetchedModelPickerFieldDescriptor,
	type ProviderFieldDescriptor,
	type ProviderModelTierSelectFieldDescriptor,
	type ProviderNoteFieldDescriptor,
	type ProviderOptionalUrlFieldDescriptor,
	type ProviderSelectFieldDescriptor,
	type ProviderSettings,
	type ProviderTextFieldDescriptor,
	type ProviderUrlFieldDescriptor,
	PROVIDER_DESCRIPTORS,
	matchesProviderFieldRule,
	providerApiKeyFields,
	resolveProviderFormModelId,
	resolveProviderGetKeyUrl,
	resolveProviderModelSourceOptions,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useProviderModels } from "@src/components/ui/hooks/useProviderModels"
import {
	Link,
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

import { ModelPicker } from "../ModelPicker"
import { ApiKeyField, type ProviderFormProps, useProviderField } from "./shared"

type ProviderDescriptorFormProps = ProviderFormProps & {
	provider: DescriptorFormProviderId
	/** The selected model's info as the settings resolve it (`useSelectedModel`); feeds `modelTierSelect`. */
	selectedModelInfo?: ModelInfo
}

// Widened to the field union: a row's literal type only lists the kinds that row uses.
const fieldsOf = (provider: DescriptorFormProviderId): readonly ProviderFieldDescriptor[] =>
	PROVIDER_DESCRIPTORS[provider].form.fields

/**
 * The settings form of every provider whose `PROVIDER_DESCRIPTORS` row lists its fields
 * (packages/types/src/provider-descriptors.ts). A provider that needs more than the field kinds
 * there (API key, endpoint choice, text and URL fields, optional base URL, checkbox, a choice
 * among the selected model's tiers, a picker over the fetched model list, notes, each optionally
 * shown only for some models or while another setting is set) keeps a hand-written component
 * next to this one.
 */
export const ProviderDescriptorForm = (props: ProviderDescriptorFormProps) =>
	fieldsOf(props.provider).some((field) => field.kind === "fetchedModelPicker") ? (
		// Keyed by provider: switching between two such providers mounts a fresh form, as it did
		// when each had its own component.
		<FetchedModelsForm key={props.provider} {...props} />
	) : (
		<DescriptorFields {...props} />
	)

/** Requests the provider's model list once for all of its `fetchedModelPicker` fields. */
const FetchedModelsForm = (props: ProviderDescriptorFormProps) => {
	const { models = {} } = useProviderModels(
		props.provider,
		resolveProviderModelSourceOptions({ ...props.apiConfiguration, apiProvider: props.provider }),
	)

	return <DescriptorFields {...props} fetchedModels={models} />
}

const DescriptorFields = ({
	provider,
	apiConfiguration,
	setApiConfigurationField,
	selectedModelInfo,
	fetchedModels = {},
}: ProviderDescriptorFormProps & { fetchedModels?: ModelRecord }) => {
	const modelId = resolveProviderFormModelId(provider, apiConfiguration)
	const fields = fieldsOf(provider)
	const descriptor: ProviderDescriptor = PROVIDER_DESCRIPTORS[provider]

	return (
		<>
			{fields.map((field, index) => {
				if (field.visibleWhen && !matchesProviderFieldRule(field.visibleWhen, modelId, apiConfiguration)) {
					return null
				}

				switch (field.kind) {
					case "apiKey": {
						// Never null here: the row type allows an apiKey field only where
						// providerApiKeyFields names the key.
						const apiKeyField = providerApiKeyFields[provider]
						return (
							apiKeyField && (
								<ApiKeyField
									key={field.kind}
									apiConfiguration={apiConfiguration}
									setApiConfigurationField={setApiConfigurationField}
									field={apiKeyField}
									labelKey={field.labelKey}
									getKeyUrl={resolveProviderGetKeyUrl(field.getKeyUrl, apiConfiguration)}
									getKeyLabelKey={field.getKeyLabelKey}
									// Below another field the trio sits in its own group (see ApiKeyField),
									// unless the row keeps the form flat.
									grouped={index > 0 && field.grouped !== false}
								/>
							)
						)
					}
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
					case "text":
						return (
							<TextField
								key={field.key}
								field={field}
								apiConfiguration={apiConfiguration}
								setApiConfigurationField={setApiConfigurationField}
							/>
						)
					case "fetchedModelPicker":
						return (
							<FetchedModelPickerField
								key={field.key}
								field={field}
								apiConfiguration={apiConfiguration}
								setApiConfigurationField={setApiConfigurationField}
								models={fetchedModels}
								service={descriptor.service}
							/>
						)
					case "note":
						return <NoteField key={`note-${index}`} field={field} />
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

	const controls = (
		<>
			<LabeledCheckbox
				checked={apiConfiguration[field.key] ?? false}
				onCheckedChange={(checked: boolean) => setApiConfigurationField(field.key, checked)}>
				{t(field.labelKey)}
			</LabeledCheckbox>
			{field.descriptionKey && (
				<div className="text-sm text-vscode-descriptionForeground mt-1 ml-6">{t(field.descriptionKey)}</div>
			)}
		</>
	)

	return field.grouped === false ? controls : <div>{controls}</div>
}

const TextField = ({
	field,
	apiConfiguration,
	setApiConfigurationField,
}: ProviderFormProps & { field: ProviderTextFieldDescriptor }) => {
	const { t } = useAppTranslation()
	const handleInputChange = useProviderField(setApiConfigurationField)

	return (
		<ThemedTextField
			value={apiConfiguration[field.key] || ""}
			type={field.inputType}
			onInput={handleInputChange(field.key)}
			placeholder={field.placeholderKey ? t(field.placeholderKey) : field.placeholder}
			className="w-full">
			<label className="block font-medium mb-1">{t(field.labelKey)}</label>
			{field.helpKey && <div className="text-xs text-vscode-descriptionForeground mt-1">{t(field.helpKey)}</div>}
		</ThemedTextField>
	)
}

const FetchedModelPickerField = ({
	field,
	apiConfiguration,
	setApiConfigurationField,
	models,
	service,
}: ProviderFormProps & {
	field: ProviderFetchedModelPickerFieldDescriptor
	models: ModelRecord
	service: ProviderDescriptor["service"]
}) => {
	const { t } = useAppTranslation()
	const configured = apiConfiguration[field.key]
	// A configured model the server does not list; nothing is flagged until a list arrived.
	const notAvailable = !!configured && Object.keys(models).length > 0 && !(configured in models)

	return (
		<ModelPicker
			apiConfiguration={apiConfiguration}
			setApiConfigurationField={setApiConfigurationField}
			defaultModelId=""
			models={models}
			modelIdKey={field.key}
			serviceName={service?.name ?? ""}
			serviceUrl={service?.url ?? ""}
			label={field.labelKey ? t(field.labelKey) : undefined}
			errorMessage={
				notAvailable ? t("settings:validation.modelAvailability", { modelId: configured }) : undefined
			}
			hidePricing={field.hidePricing}
		/>
	)
}

const NoteField = ({ field }: { field: ProviderNoteFieldDescriptor }) => {
	const { t } = useAppTranslation()

	if (!field.links && !field.warningTag) {
		return <div className="text-sm text-vscode-descriptionForeground">{t(field.textKey)}</div>
	}

	const components: Record<string, React.ReactElement> = Object.fromEntries(
		Object.entries(field.links ?? {}).map(([tag, href]) => [tag, <Link key={tag} href={href} />]),
	)
	if (field.warningTag) {
		components[field.warningTag] = (
			<span className="text-vscode-errorForeground ml-1">
				<span className="font-medium">Note:</span>
			</span>
		)
	}

	return (
		<div className="text-sm text-vscode-descriptionForeground">
			<Trans i18nKey={field.textKey} components={components} />
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
