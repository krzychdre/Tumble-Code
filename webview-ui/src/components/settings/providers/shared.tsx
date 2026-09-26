import { useCallback } from "react"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { ThemedTextField } from "@src/components/ui"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"

export type SetApiConfigurationField = <K extends keyof ProviderSettings>(
	field: K,
	value: ProviderSettings[K],
	isUserAction?: boolean,
) => void

/** The props every provider form receives from the provider UI registry. */
export type ProviderFormProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: SetApiConfigurationField
}

/**
 * Returns `handleInputChange(field, transform?)`, which builds an event handler that writes
 * `transform(event)` (by default the input's `target.value`) to `field`.
 */
export const useProviderField = (setApiConfigurationField: SetApiConfigurationField) =>
	useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

type StringSettingKey = {
	[K in keyof ProviderSettings]-?: ProviderSettings[K] extends string | undefined ? K : never
}[keyof ProviderSettings]

type ApiKeyFieldProps = ProviderFormProps & {
	/** The ProviderSettings key that stores the API key. */
	field: StringSettingKey
	/** i18n key of the field label. */
	labelKey: string
	/** Where the "get an API key" link points; the link is shown only while the key is empty. */
	getKeyUrl: string
	/** i18n key of the "get an API key" link text. */
	getKeyLabelKey: string
	/**
	 * Wrap the trio in its own `<div>`. The storage notice then drops the negative top margin that
	 * compensates for the form's flex gap, because inside the wrapper there is no gap.
	 */
	grouped?: boolean
}

/** The "API key field + storage notice + get-key link" trio shared by the provider forms. */
export const ApiKeyField = ({
	apiConfiguration,
	setApiConfigurationField,
	field,
	labelKey,
	getKeyUrl,
	getKeyLabelKey,
	grouped = false,
}: ApiKeyFieldProps) => {
	const { t } = useAppTranslation()
	const handleInputChange = useProviderField(setApiConfigurationField)
	const apiKey = apiConfiguration?.[field]

	const trio = (
		<>
			<ThemedTextField
				value={apiKey || ""}
				type="password"
				onInput={handleInputChange(field)}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t(labelKey)}</label>
			</ThemedTextField>
			<div
				className={
					grouped
						? "text-sm text-vscode-descriptionForeground"
						: "text-sm text-vscode-descriptionForeground -mt-2"
				}>
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiKey && (
				<VSCodeButtonLink href={getKeyUrl} appearance="secondary">
					{t(getKeyLabelKey)}
				</VSCodeButtonLink>
			)}
		</>
	)

	return grouped ? <div>{trio}</div> : trio
}
