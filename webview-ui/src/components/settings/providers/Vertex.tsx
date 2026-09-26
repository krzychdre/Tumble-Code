import { useMemo } from "react"
import { Trans } from "react-i18next"
import { Checkbox } from "vscrui"

import { VERTEX_REGIONS, VERTEX_1M_CONTEXT_MODEL_IDS, looksLikeFilePath } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Link,
	ThemedTextField,
} from "@src/components/ui"

import { type ProviderFormProps, useProviderField } from "./shared"

type VertexProps = ProviderFormProps

export const Vertex = ({ apiConfiguration, setApiConfigurationField }: VertexProps) => {
	const { t } = useAppTranslation()

	// Check if the selected model supports 1M context (supported Claude 4 models)
	const supports1MContextBeta =
		!!apiConfiguration?.apiModelId &&
		VERTEX_1M_CONTEXT_MODEL_IDS.includes(
			apiConfiguration.apiModelId as (typeof VERTEX_1M_CONTEXT_MODEL_IDS)[number],
		)

	const handleInputChange = useProviderField(setApiConfigurationField)

	const credentialsLooksLikePath = useMemo(
		() => looksLikeFilePath(apiConfiguration?.vertexJsonCredentials),
		[apiConfiguration?.vertexJsonCredentials],
	)

	return (
		<>
			<div className="text-sm text-vscode-descriptionForeground">
				<div>{t("settings:providers.googleCloudSetup.title")}</div>
				<div>
					<Link
						href="https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#before_you_begin"
						className="text-sm">
						{t("settings:providers.googleCloudSetup.step1")}
					</Link>
				</div>
				<div>
					<Link
						href="https://cloud.google.com/docs/authentication/provide-credentials-adc#google-idp"
						className="text-sm">
						{t("settings:providers.googleCloudSetup.step2")}
					</Link>
				</div>
				<div>
					<Link
						href="https://developers.google.com/workspace/guides/create-credentials?hl=en#service-account"
						className="text-sm">
						{t("settings:providers.googleCloudSetup.step3")}
					</Link>
				</div>
			</div>
			<ThemedTextField
				value={apiConfiguration?.vertexJsonCredentials || ""}
				onInput={handleInputChange("vertexJsonCredentials")}
				placeholder={t("settings:placeholders.credentialsJson")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.googleCloudCredentials")}</label>
			</ThemedTextField>
			{credentialsLooksLikePath && (
				<div
					data-testid="vertex-credentials-path-warning"
					role="status"
					className="text-sm text-vscode-errorForeground">
					<Trans
						i18nKey="settings:providers.googleCloudCredentialsPathWarning"
						components={{
							strong: <strong />,
							code: <code />,
						}}
					/>
				</div>
			)}
			<ThemedTextField
				value={apiConfiguration?.vertexKeyFile || ""}
				onInput={handleInputChange("vertexKeyFile")}
				placeholder={t("settings:placeholders.keyFilePath")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.googleCloudKeyFile")}</label>
			</ThemedTextField>
			<ThemedTextField
				value={apiConfiguration?.vertexProjectId || ""}
				onInput={handleInputChange("vertexProjectId")}
				placeholder={t("settings:placeholders.projectId")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.googleCloudProjectId")}</label>
			</ThemedTextField>
			<div>
				<label className="block font-medium mb-1">{t("settings:providers.googleCloudRegion")}</label>
				<Select
					value={apiConfiguration?.vertexRegion || ""}
					onValueChange={(value) => setApiConfigurationField("vertexRegion", value)}>
					<SelectTrigger className="w-full">
						<SelectValue placeholder={t("settings:common.select")} />
					</SelectTrigger>
					<SelectContent>
						{VERTEX_REGIONS.map(({ value, label }) => (
							<SelectItem key={value} value={value}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{supports1MContextBeta && (
				<div>
					<Checkbox
						data-testid="checkbox-vertex-1m-context"
						checked={apiConfiguration?.vertex1MContext ?? false}
						onChange={(checked: boolean) => {
							setApiConfigurationField("vertex1MContext", checked)
						}}>
						{t("settings:providers.vertex1MContextBetaLabel")}
					</Checkbox>
					<div className="text-sm text-vscode-descriptionForeground mt-1 ml-6">
						{t("settings:providers.vertex1MContextBetaDescription")}
					</div>
				</div>
			)}
		</>
	)
}
