import React from "react"
import { VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"

import type { EmbeddingModelProfile } from "@roo-code/types"

import { cn } from "@src/lib/utils"

import type { CodeIndexSettingKey, CodeIndexTranslate, LocalCodeIndexSettings } from "./codeIndexSettings"

/** Everything an embedder provider form needs from the popover. */
export type EmbedderFormContext = {
	settings: LocalCodeIndexSettings
	formErrors: Record<string, string>
	updateSetting: (key: CodeIndexSettingKey, value: any) => void
	/** Models the current provider offers, in catalog order. */
	models: Array<{ id: string; profile: EmbeddingModelProfile | undefined }>
	/** OpenRouter routing choices for the selected embedding model, if any were fetched. */
	openRouterEmbeddingProviders: Record<string, { label: string }> | undefined
	t: CodeIndexTranslate
}

type FieldProps = { context: EmbedderFormContext }

const FieldError = ({ message }: { message: string | undefined }) =>
	message ? <p className="text-xs text-vscode-errorForeground mt-1 mb-0">{message}</p> : null

type SettingTextFieldProps = FieldProps & {
	field: CodeIndexSettingKey
	labelKey: string
	placeholderKey: string
	type?: "password"
	optional?: boolean
	descriptionKey?: string
	onBlur?: (e: any) => void
}

/** A labelled text field bound to one string setting, with its validation error below. */
export const SettingTextField = ({
	context,
	field,
	labelKey,
	placeholderKey,
	type,
	optional,
	descriptionKey,
	onBlur,
}: SettingTextFieldProps) => {
	const { settings, formErrors, updateSetting, t } = context
	return (
		<div className="space-y-2">
			<label className="text-sm font-medium">
				{t(labelKey)}
				{optional && (
					<span className="text-xs text-vscode-descriptionForeground ml-1">
						({t("settings:codeIndex.optional")})
					</span>
				)}
			</label>
			<VSCodeTextField
				type={type}
				value={(settings[field] as string | undefined) || ""}
				onInput={(e: any) => updateSetting(field, e.target.value)}
				onBlur={onBlur}
				placeholder={t(placeholderKey)}
				className={cn("w-full", {
					"border-red-500": formErrors[field],
				})}
			/>
			<FieldError message={formErrors[field]} />
			{descriptionKey && !formErrors[field] && (
				<p className="text-xs text-vscode-descriptionForeground mt-1 mb-0">{t(descriptionKey)}</p>
			)}
		</div>
	)
}

/** The typed model id of the providers without a model catalog (Ollama, OpenAI compatible). */
export const ModelIdTextField = ({ context }: FieldProps) => (
	<SettingTextField
		context={context}
		field="codebaseIndexEmbedderModelId"
		labelKey="settings:codeIndex.modelLabel"
		placeholderKey="settings:codeIndex.modelPlaceholder"
	/>
)

/** The vector dimension typed by the user; an empty or non-numeric value is stored as `undefined`. */
export const ModelDimensionField = ({ context }: FieldProps) => {
	const { settings, formErrors, updateSetting, t } = context
	return (
		<div className="space-y-2">
			<label className="text-sm font-medium">{t("settings:codeIndex.modelDimensionLabel")}</label>
			<VSCodeTextField
				value={settings.codebaseIndexEmbedderModelDimension?.toString() || ""}
				onInput={(e: any) => {
					const value = e.target.value ? parseInt(e.target.value, 10) || undefined : undefined
					updateSetting("codebaseIndexEmbedderModelDimension", value)
				}}
				placeholder={t("settings:codeIndex.modelDimensionPlaceholder")}
				className={cn("w-full", {
					"border-red-500": formErrors.codebaseIndexEmbedderModelDimension,
				})}
			/>
			<FieldError message={formErrors.codebaseIndexEmbedderModelDimension} />
		</div>
	)
}

/** The model picked from the provider's catalog, each option showing its dimension. */
export const ModelDropdownField = ({ context }: FieldProps) => {
	const { settings, formErrors, updateSetting, models, t } = context
	return (
		<div className="space-y-2">
			<label className="text-sm font-medium">{t("settings:codeIndex.modelLabel")}</label>
			<VSCodeDropdown
				value={settings.codebaseIndexEmbedderModelId}
				onChange={(e: any) => updateSetting("codebaseIndexEmbedderModelId", e.target.value)}
				className={cn("w-full", {
					"border-red-500": formErrors.codebaseIndexEmbedderModelId,
				})}>
				<VSCodeOption value="" className="p-2">
					{t("settings:codeIndex.selectModel")}
				</VSCodeOption>
				{models.map(({ id, profile }) => (
					<VSCodeOption key={id} value={id} className="p-2">
						{id} {profile ? t("settings:codeIndex.modelDimensions", { dimension: profile.dimension }) : ""}
					</VSCodeOption>
				))}
			</VSCodeDropdown>
			<FieldError message={formErrors.codebaseIndexEmbedderModelId} />
		</div>
	)
}

type ApiKeyAndModelFieldsProps = FieldProps & {
	apiKeyField: CodeIndexSettingKey
	apiKeyLabelKey: string
	apiKeyPlaceholderKey: string
}

/** The "API key plus model from the catalog" form most hosted embedders use. */
export const ApiKeyAndModelFields = ({
	context,
	apiKeyField,
	apiKeyLabelKey,
	apiKeyPlaceholderKey,
}: ApiKeyAndModelFieldsProps) => (
	<>
		<SettingTextField
			context={context}
			field={apiKeyField}
			labelKey={apiKeyLabelKey}
			placeholderKey={apiKeyPlaceholderKey}
			type="password"
		/>
		<ModelDropdownField context={context} />
	</>
)
