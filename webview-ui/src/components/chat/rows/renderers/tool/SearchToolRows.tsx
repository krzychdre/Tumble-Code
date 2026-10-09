import React from "react"
import { Trans, useTranslation } from "react-i18next"

import { toolPayloadSearchScope } from "@tumble-code/core/browser"

import { vscode } from "@src/utils/vscode"
import CodeAccordion from "@src/components/common/CodeAccordion"
import { BlockTimestamp } from "@src/components/chat/BlockTimestamp"

import { headerStyle, toolIcon } from "../shared"
import type { ToolRendererProps } from "../types"

import { splitSearchQuery, splitWebUrl } from "./webToolText"

/** A semantic search of the code index. */
export const CodebaseSearchToolRow = ({ tool }: ToolRendererProps) => (
	<div style={headerStyle}>
		{toolIcon("search")}
		<span style={{ fontWeight: "bold" }}>
			{tool.path ? (
				<Trans
					i18nKey="chat:codebaseSearch.wantsToSearchWithPath"
					components={{ code: <code></code> }}
					values={{ query: tool.query, path: tool.path }}
				/>
			) : (
				<Trans
					i18nKey="chat:codebaseSearch.wantsToSearch"
					components={{ code: <code></code> }}
					values={{ query: tool.query }}
				/>
			)}
		</span>
	</div>
)

/** The pill on the right of a web row's header, styled like the API request cost. */
const headerPill = "text-xs text-vscode-descriptionForeground border-frame border rounded-control px-1.5 py-0.5"

/**
 * The header a web row shares with the API request row: icon, short title,
 * start time and duration. The title stays the same before and after approval,
 * because an auto-approved ask is never rewritten into a say.
 */
const WebRowHeader = ({
	icon,
	title,
	message,
	meta,
	pill,
}: Pick<ToolRendererProps, "message" | "meta"> & { icon: string; title: string; pill?: string }) => (
	<div className="text-sm" style={headerStyle}>
		{toolIcon(icon)}
		<span style={{ fontWeight: "bold" }}>{title}</span>
		<BlockTimestamp startTs={message.ts} endTs={message.partial ? undefined : meta.nextTs} />
		<span className="flex-grow" />
		{pill && <span className={headerPill}>{pill}</span>}
	</div>
)

const QueryText = ({ query }: { query: string }) => (
	<>
		{splitSearchQuery(query).map((part, i) =>
			part.kind === "operator" ? (
				<span key={i} className="font-mono text-[0.9em] text-vscode-textLink-foreground">
					{part.text}
				</span>
			) : part.kind === "quote" ? (
				<span key={i} className="text-[var(--vscode-textPreformat-foreground)]">
					{part.text}
				</span>
			) : (
				<React.Fragment key={i}>{part.text}</React.Fragment>
			),
		)}
	</>
)

/** A web search: one line per query in a card under the header. */
export const WebSearchToolRow = ({ message, tool, meta }: ToolRendererProps) => {
	const { t } = useTranslation()
	const queries = (tool.queries ?? []).filter((query) => query.trim() !== "")
	return (
		<>
			<WebRowHeader
				icon="search"
				title={t("chat:webSearch.title")}
				message={message}
				meta={meta}
				pill={queries.length > 0 ? t("chat:webSearch.queryCount", { count: queries.length }) : undefined}
			/>
			{queries.length > 0 && (
				<div className="pl-6">
					<ul className="m-0 list-none bg-surface border border-frame rounded-control py-1 px-0">
						{queries.map((query, i) => (
							<li key={i} className="flex items-start gap-2 px-2.5 py-0.5" title={query}>
								<span
									className="codicon codicon-search text-xs text-vscode-descriptionForeground shrink-0 mt-[3px]"
									aria-hidden="true"
								/>
								<span className="min-w-0 line-clamp-2 break-words">
									<QueryText query={query} />
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</>
	)
}

/** A web page fetch: the page's host and path in a card that opens it in the browser. */
export const WebFetchToolRow = ({ message, tool, meta }: ToolRendererProps) => {
	const { t } = useTranslation()
	const url = tool.fetchedUrl ?? ""
	const parts = splitWebUrl(url)
	return (
		<>
			<WebRowHeader icon="globe" title={t("chat:webFetch.title")} message={message} meta={meta} />
			{url !== "" && (
				<div className="pl-6">
					{parts ? (
						<button
							type="button"
							className="group flex w-full min-w-0 min-h-[28px] items-center gap-2 border border-frame rounded-control bg-surface hover:bg-surface-hover hover:border-frame-hover px-2.5 py-1 text-left text-vscode-foreground cursor-pointer transition-colors focus-ring"
							title={t("chat:webFetch.openInBrowser", { url })}
							onClick={() => vscode.postMessage({ type: "openExternal", url })}>
							<span
								className="codicon codicon-globe text-xs text-vscode-descriptionForeground shrink-0"
								aria-hidden="true"
							/>
							<span className="font-semibold shrink-0">{parts.host}</span>
							<span className="min-w-0 truncate font-mono text-xs text-vscode-descriptionForeground">
								{parts.rest}
							</span>
							<span
								className="codicon codicon-link-external ml-auto text-xs text-vscode-descriptionForeground shrink-0 group-hover:text-vscode-foreground"
								aria-hidden="true"
							/>
						</button>
					) : (
						<div className="bg-surface border border-frame rounded-control px-2.5 py-1.5 font-mono text-xs break-all">
							{url}
						</div>
					)}
				</div>
			)}
		</>
	)
}

/** A regex search over files. */
export const SearchFilesToolRow = ({ message, tool, isExpanded, toggleExpand }: ToolRendererProps) => (
	<>
		<div style={headerStyle}>
			{toolIcon("search")}
			<span style={{ fontWeight: "bold" }}>
				{message.type === "ask" ? (
					<Trans
						i18nKey={
							tool.isOutsideWorkspace
								? "chat:directoryOperations.wantsToSearchOutsideWorkspace"
								: "chat:directoryOperations.wantsToSearch"
						}
						components={{ code: <code className="font-medium">{tool.regex}</code> }}
						values={{ regex: tool.regex }}
					/>
				) : (
					<Trans
						i18nKey={
							tool.isOutsideWorkspace
								? "chat:directoryOperations.didSearchOutsideWorkspace"
								: "chat:directoryOperations.didSearch"
						}
						components={{ code: <code className="font-medium">{tool.regex}</code> }}
						values={{ regex: tool.regex }}
					/>
				)}
			</span>
		</div>
		<div className="pl-6">
			<CodeAccordion
				path={toolPayloadSearchScope(tool)}
				code={tool.content}
				language="shellsession"
				isExpanded={isExpanded}
				onToggleExpand={toggleExpand}
			/>
		</div>
	</>
)
