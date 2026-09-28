import { CODEBASE_INDEX_DEFAULTS } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Slider, StandardTooltip, ThemedButton } from "@src/components/ui"

import type { EmbedderFormContext } from "./EmbedderFormFields"

type CodeIndexAdvancedFieldsProps = Pick<EmbedderFormContext, "settings" | "updateSetting">

/** Advanced group of the code index form: the search score threshold and result count sliders. */
export const CodeIndexAdvancedFields = ({ settings: currentSettings, updateSetting }: CodeIndexAdvancedFieldsProps) => {
	const { t } = useAppTranslation()

	return (
		<>
			{/* Search Score Threshold Slider */}
			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<label className="text-sm font-medium">{t("settings:codeIndex.searchMinScoreLabel")}</label>
					<StandardTooltip content={t("settings:codeIndex.searchMinScoreDescription")}>
						<span className="codicon codicon-info text-xs text-vscode-descriptionForeground cursor-help" />
					</StandardTooltip>
				</div>
				<div className="flex items-center gap-2">
					<Slider
						min={CODEBASE_INDEX_DEFAULTS.MIN_SEARCH_SCORE}
						max={CODEBASE_INDEX_DEFAULTS.MAX_SEARCH_SCORE}
						step={CODEBASE_INDEX_DEFAULTS.SEARCH_SCORE_STEP}
						value={[
							currentSettings.codebaseIndexSearchMinScore ??
								CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE,
						]}
						onValueChange={(values) => updateSetting("codebaseIndexSearchMinScore", values[0])}
						className="flex-1"
						data-testid="search-min-score-slider"
					/>
					<span className="w-12 text-center">
						{(
							currentSettings.codebaseIndexSearchMinScore ??
							CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE
						).toFixed(2)}
					</span>
					<ThemedButton
						appearance="icon"
						title={t("settings:codeIndex.resetToDefault")}
						onClick={() =>
							updateSetting(
								"codebaseIndexSearchMinScore",
								CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE,
							)
						}>
						<span className="codicon codicon-discard" />
					</ThemedButton>
				</div>
			</div>

			{/* Maximum Search Results Slider */}
			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<label className="text-sm font-medium">{t("settings:codeIndex.searchMaxResultsLabel")}</label>
					<StandardTooltip content={t("settings:codeIndex.searchMaxResultsDescription")}>
						<span className="codicon codicon-info text-xs text-vscode-descriptionForeground cursor-help" />
					</StandardTooltip>
				</div>
				<div className="flex items-center gap-2">
					<Slider
						min={CODEBASE_INDEX_DEFAULTS.MIN_SEARCH_RESULTS}
						max={CODEBASE_INDEX_DEFAULTS.MAX_SEARCH_RESULTS}
						step={CODEBASE_INDEX_DEFAULTS.SEARCH_RESULTS_STEP}
						value={[
							currentSettings.codebaseIndexSearchMaxResults ??
								CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS,
						]}
						onValueChange={(values) => updateSetting("codebaseIndexSearchMaxResults", values[0])}
						className="flex-1"
						data-testid="search-max-results-slider"
					/>
					<span className="w-12 text-center">
						{currentSettings.codebaseIndexSearchMaxResults ??
							CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS}
					</span>
					<ThemedButton
						appearance="icon"
						title={t("settings:codeIndex.resetToDefault")}
						onClick={() =>
							updateSetting(
								"codebaseIndexSearchMaxResults",
								CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS,
							)
						}>
						<span className="codicon codicon-discard" />
					</ThemedButton>
				</div>
			</div>
		</>
	)
}
