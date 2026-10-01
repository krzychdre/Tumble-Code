import type { McpResource, McpResourceTemplate } from "@roo-code/types"

type McpResourceRowProps = {
	item: McpResource | McpResourceTemplate
}

const McpResourceRow = ({ item }: McpResourceRowProps) => {
	const hasUri = "uri" in item
	const uri = hasUri ? item.uri : item.uriTemplate

	return (
		<div key={uri} className="py-0.5">
			<div className="flex items-center mb-1">
				<span className="codicon codicon-symbol-file mr-1.5" aria-hidden="true" />
				<span className="font-medium break-all">{uri}</span>
			</div>
			<div className="my-1 text-sm opacity-80">
				{item.name && item.description
					? `${item.name}: ${item.description}`
					: !item.name && item.description
						? item.description
						: !item.description && item.name
							? item.name
							: "No description"}
			</div>
			<div className="text-sm">
				<span className="opacity-80">Returns </span>
				<code className="px-1 py-px text-[var(--vscode-textPreformat-foreground)] bg-[var(--vscode-textPreformat-background)]">
					{item.mimeType || "Unknown"}
				</code>
			</div>
		</div>
	)
}

export default McpResourceRow
