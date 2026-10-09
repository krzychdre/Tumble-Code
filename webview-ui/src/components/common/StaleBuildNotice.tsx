import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"

/**
 * Shown in place of a lazy tab whose chunk could not be fetched. That happens
 * when the extension is reinstalled or updated while this window stays open:
 * the running page still asks for the old hashed chunk files, which the new
 * install has replaced. Only a window reload loads the new build.
 */
export const StaleBuildNotice = () => {
	const { t } = useAppTranslation()

	return (
		<div
			data-testid="stale-build-notice"
			className="m-4 px-4 py-2.5 rounded-control border text-sm leading-normal text-vscode-foreground bg-[var(--vscode-inputValidation-warningBackground)] border-[var(--vscode-inputValidation-warningBorder)]">
			<div className="mb-0.5 font-bold">{t("common:staleBuild.title")}</div>
			<div>{t("common:staleBuild.description")}</div>
			<button
				onClick={() => vscode.postMessage({ type: "reloadWindow" })}
				className="mt-1.5 rounded-control underline cursor-pointer bg-transparent border-none p-0 text-vscode-textLink-foreground hover:text-[var(--vscode-textLink-activeForeground)] focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-vscode-focusBorder">
				{t("common:staleBuild.reload")}
			</button>
		</div>
	)
}
