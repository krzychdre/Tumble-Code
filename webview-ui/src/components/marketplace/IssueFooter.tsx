import React from "react"
import { Trans } from "react-i18next"
import { Link } from "@src/components/ui"

export const IssueFooter: React.FC = () => {
	return (
		<div className="text-xs text-vscode-descriptionForeground p-3">
			<Trans i18nKey="marketplace:footer.issueText">
				<Link
					href="https://github.com/RooCodeInc/Roo-Code/issues/new?template=marketplace.yml"
					style={{ display: "inline", fontSize: "inherit" }}>
					Open a GitHub issue
				</Link>
			</Trans>
		</div>
	)
}
