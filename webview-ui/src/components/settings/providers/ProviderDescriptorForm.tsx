import { useId, useState } from "react"
import { Trans } from "react-i18next"

import {
	type DescriptorFormProviderId,
	type ModelInfo,
	type ModelRecord,
	type ProviderCheckboxFieldDescriptor,
	type ProviderDescriptor,
	type ProviderFetchedModelPickerFieldDescriptor,
	type ProviderFieldDescriptor,
	type ProviderIntegerFieldDescriptor,
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
} from "@tumble-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useProviderModels } from "@src/hooks/models/useProviderModels"
import {
	Link,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	StandardTooltip,
	Input,
} from "@src/components/ui"
import { LabeledCheckbox } from "@src/components/ui/labeled-checkbox"
import { useTextDraft } from "@src/components/ui/hooks"

import { ModelPicker } from "../ModelPicker"
import { ApiKeyField, type ProviderFormProps, useProviderField } from "./shared"
import { checkboxDescription, settingDescription } from "../SettingsCard"

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
					case "integer":
						return (
							<IntegerField
								key={field.key}
								field={field}
								apiConfiguration={apiConfiguration}
								setApiConfigurationField={setApiConfigurationField}
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
	const stored = apiConfiguration[field.key] || field.defaultValue
	// A stored value the list does not offer shows the first option, as the field always has one.
	const value = field.options.some((option) => option.value === stored) ? stored : field.options[0]?.value
	const triggerId = useId()

	return (
		<div>
			<label htmlFor={triggerId} className="block font-medium mb-1">
				{t(field.labelKey)}
			</label>
			<Select
				value={value}
				onValueChange={(next) =>
					setApiConfigurationField(field.key, next as ProviderSettings[typeof field.key])
				}>
				<SelectTrigger id={triggerId} className="w-full">
					<SelectValue placeholder={t("settings:common.select")} />
				</SelectTrigger>
				<SelectContent>
					{field.options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
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
		<div>
			<label className="block w-full leading-[normal]">
				<span className="block font-medium mb-1">{t(field.labelKey)}</span>
				<Input
					value={apiConfiguration[field.key] || ""}
					type="url"
					onChange={handleInputChange(field.key)}
					placeholder={field.placeholder}
				/>
			</label>
			{field.descriptionKey && <div className={settingDescription}>{t(field.descriptionKey)}</div>}
		</div>
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
				<div className={checkboxDescription}>{t(field.descriptionKey)}</div>
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
		<label className="block w-full leading-[normal]">
			<span className="block font-medium mb-1">{t(field.labelKey)}</span>
			{field.helpKey && (
				<span className="block text-xs text-vscode-descriptionForeground mt-1 mb-0.5">{t(field.helpKey)}</span>
			)}
			<Input
				value={apiConfiguration[field.key] || ""}
				type={field.inputType}
				onChange={handleInputChange(field.key)}
				placeholder={field.placeholderKey ? t(field.placeholderKey) : field.placeholder}
			/>
		</label>
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

const IntegerField = ({
	field,
	apiConfiguration,
	setApiConfigurationField,
}: ProviderFormProps & { field: ProviderIntegerFieldDescriptor }) => {
	const { t } = useAppTranslation()
	// The typed text stays while it is not a valid number yet (below the minimum, "-").
	const draft = useTextDraft(apiConfiguration[field.key]?.toString() || "")

	return (
		<label className="block w-full leading-[normal]">
			<span className="block font-medium mb-1">{t(field.labelKey)}</span>
			{field.helpKey && (
				<span className="block text-xs text-vscode-descriptionForeground mt-1 mb-0.5">{t(field.helpKey)}</span>
			)}
			<Input
				value={draft.value}
				onChange={(e) => {
					draft.onChange(e)
					const value = e.target.value
					if (value === "") {
						setApiConfigurationField(field.key, undefined)
					} else {
						const numValue = parseInt(value, 10)
						if (!isNaN(numValue) && numValue >= (field.min ?? -Infinity)) {
							setApiConfigurationField(field.key, numValue)
						}
					}
				}}
				placeholder={field.placeholder}
			/>
		</label>
	)
}

const NoteField = ({ field }: { field: ProviderNoteFieldDescriptor }) => {
	const { t } = useAppTranslation()

	if (!field.links && !field.warningTag) {
		return (
			<div className="text-sm text-vscode-descriptionForeground">
				{t(field.textKey)}
				{field.warningKey && <span className="text-vscode-errorForeground ml-1">{t(field.warningKey)}</span>}
			</div>
		)
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
					<Input
						value={apiConfiguration[field.key] || ""}
						type="url"
						onChange={handleInputChange(field.key)}
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
						<i
							className="codicon codicon-info text-vscode-descriptionForeground text-xs"
							aria-hidden="true"
						/>
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
