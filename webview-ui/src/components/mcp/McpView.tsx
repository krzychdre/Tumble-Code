import { Trans } from "react-i18next"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useTooManyTools } from "@src/hooks/useTooManyTools"
import { Button, StandardTooltip, Link } from "@src/components/ui"
import { Section } from "@src/components/settings/Section"
import { SectionHeader } from "@src/components/settings/SectionHeader"

import McpEnabledToggle from "./McpEnabledToggle"
import { ServerRow } from "./ServerRow"

const McpView = () => {
	const { mcpServers: servers, alwaysAllowMcp, mcpEnabled } = useExtensionState()

	const { t } = useAppTranslation()
	const { isOverThreshold, title, message } = useTooManyTools()

	return (
		<div>
			<SectionHeader>{t("mcp:title")}</SectionHeader>

			<Section>
				<div className="mb-row text-base text-vscode-foreground">
					<Trans i18nKey="mcp:description">
						<Link href="https://modelcontextprotocol.io" className="inline">
							Learn More
						</Link>
					</Trans>
				</div>

				<McpEnabledToggle />

				{mcpEnabled && (
					<>
						{/* Too Many Tools Warning */}
						{isOverThreshold && (
							<div className="mb-block">
								<div className="flex items-center gap-1.5 mb-1 font-medium text-vscode-editorWarning-foreground">
									<span className="codicon codicon-warning" aria-hidden="true" />
									{title}
								</div>
								<div className="text-sm text-vscode-descriptionForeground">{message}</div>
							</div>
						)}

						{/* Server List */}
						{servers.length > 0 && (
							<div className="flex flex-col gap-row">
								{servers.map((server) => (
									<ServerRow
										key={`${server.name}-${server.source || "global"}`}
										server={server}
										alwaysAllowMcp={alwaysAllowMcp}
									/>
								))}
							</div>
						)}

						{/* Edit Settings Buttons */}
						<div className="grid w-full grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-block mt-block">
							<Button
								variant="secondary"
								className="w-full"
								onClick={() => {
									vscode.postMessage({ type: "openMcpSettings" })
								}}>
								<span className="codicon codicon-edit mr-1.5" aria-hidden="true" />
								{t("mcp:editGlobalMCP")}
							</Button>
							<Button
								variant="secondary"
								className="w-full"
								onClick={() => {
									vscode.postMessage({ type: "openProjectMcpSettings" })
								}}>
								<span className="codicon codicon-edit mr-1.5" aria-hidden="true" />
								{t("mcp:editProjectMCP")}
							</Button>
							<Button
								variant="secondary"
								className="w-full"
								onClick={() => {
									vscode.postMessage({ type: "refreshAllMcpServers" })
								}}>
								<span className="codicon codicon-refresh mr-1.5" aria-hidden="true" />
								{t("mcp:refreshMCP")}
							</Button>
							<StandardTooltip content={t("mcp:marketplace")}>
								<Button
									variant="secondary"
									className="w-full"
									onClick={() => {
										window.postMessage(
											{
												type: "action",
												action: "marketplaceButtonClicked",
												values: { marketplaceTab: "mcp" },
											},
											"*",
										)
									}}>
									<span className="codicon codicon-extensions mr-1.5" aria-hidden="true" />
									{t("mcp:marketplace")}
								</Button>
							</StandardTooltip>
						</div>
					</>
				)}
			</Section>
		</div>
	)
}

export default McpView
