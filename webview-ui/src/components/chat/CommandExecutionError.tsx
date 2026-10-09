import { useCallback } from "react"
import { useTranslation, Trans } from "react-i18next"
import { Link } from "@src/components/ui"

export const CommandExecutionError = () => {
	const { t } = useTranslation()

	const onClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
		e.preventDefault()
		window.postMessage({ type: "action", action: "settingsButtonClicked", values: { section: "terminal" } }, "*")
	}, [])

	return (
		<div className="text-sm bg-surface border border-frame rounded-control p-3 ml-6">
			<div className="flex flex-col gap-2">
				<div className="flex items-center">
					<i
						className="codicon codicon-warning mr-1 text-vscode-editorWarning-foreground"
						aria-hidden="true"
					/>
					<span className="text-vscode-editorWarning-foreground font-semibold">
						{t("chat:shellIntegration.title")}
					</span>
				</div>
				<div>
					<Trans
						i18nKey="chat:shellIntegration.description"
						components={{
							settingsLink: <Link href="#" onClick={onClick} className="inline" />,
						}}
					/>
				</div>
			</div>
		</div>
	)
}
