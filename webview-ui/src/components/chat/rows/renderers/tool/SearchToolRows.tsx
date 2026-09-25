import { Trans } from "react-i18next"

import CodeAccordion from "@src/components/common/CodeAccordion"

import { headerStyle, toolIcon } from "../shared"
import type { ToolRendererProps } from "../types"

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

/** A web search, with the queries it runs. */
export const WebSearchToolRow = ({ message, tool }: ToolRendererProps) => {
	const queries = Array.isArray(tool.queries) ? tool.queries.join(", ") : ""
	return (
		<div style={headerStyle}>
			{toolIcon("search")}
			<span style={{ fontWeight: "bold" }}>
				<Trans
					i18nKey={message.type === "ask" ? "chat:webSearch.wantsToSearch" : "chat:webSearch.didSearch"}
					components={{ code: <code></code> }}
					values={{ queries }}
				/>
			</span>
		</div>
	)
}

/** A web page fetch, with the URL it read. */
export const WebFetchToolRow = ({ message, tool }: ToolRendererProps) => (
	<div style={headerStyle}>
		{toolIcon("globe")}
		<span style={{ fontWeight: "bold" }}>
			<Trans
				i18nKey={message.type === "ask" ? "chat:webFetch.wantsToFetch" : "chat:webFetch.didFetch"}
				components={{ code: <code></code> }}
				values={{ url: tool.fetchedUrl }}
			/>
		</span>
	</div>
)

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
				path={tool.path! + (tool.filePattern ? `/(${tool.filePattern})` : "")}
				code={tool.content}
				language="shellsession"
				isExpanded={isExpanded}
				onToggleExpand={toggleExpand}
			/>
		</div>
	</>
)
