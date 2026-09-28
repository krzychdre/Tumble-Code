import { useState } from "react"

import {
	type DescriptorFormProviderId,
	type ProviderCheckboxFieldDescriptor,
	type ProviderFieldDescriptor,
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
import { ThemedDropdown, ThemedOption, ThemedTextField } from "@src/components/ui"
import { VSCRUICheckbox as Checkbox } from "@src/components/ui/vscrui-checkbox"

import { ApiKeyField, type ProviderFormProps, useProviderField } from "./shared"

/**
 * The settings form of every provider whose `PROVIDER_DESCRIPTORS` row lists its fields
 * (packages/types/src/provider-descriptors.ts). A provider that needs more than the field kinds
 * there (API key, endpoint choice, URL, optional base URL, checkbox, each optionally shown only
 * for some models) keeps a hand-written component next to this one.
 */
export const ProviderDescriptorForm = ({
	provider,
	apiConfiguration,
	setApiConfigurationField,
}: ProviderFormProps & { provider: DescriptorFormProviderId }) => {
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
								// Below another field the trio sits in its own group (see ApiKeyField).
								grouped={index > 0}
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
			<Checkbox
				checked={apiConfiguration[field.key] ?? false}
				onChange={(checked: boolean) => setApiConfigurationField(field.key, checked)}>
				{t(field.labelKey)}
			</Checkbox>
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

	return (
		<div>
			<Checkbox
				data-testid={field.toggleTestId}
				checked={selected}
				onChange={(checked: boolean) => {
					setSelected(checked)
					if (!checked) {
						setApiConfigurationField(field.key, "")
						for (const [key, value] of Object.entries(field.alsoClear ?? {})) {
							setApiConfigurationField(key as keyof ProviderSettings, value)
						}
					}
				}}>
				{t(field.toggleLabelKey)}
			</Checkbox>
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
						<Checkbox
							key={revealed.key}
							checked={apiConfiguration[revealed.key] ?? false}
							onChange={(checked: boolean) => setApiConfigurationField(revealed.key, checked)}
							className="w-full mt-1">
							{t(revealed.labelKey)}
						</Checkbox>
					))}
				</>
			)}
		</div>
	)
}
