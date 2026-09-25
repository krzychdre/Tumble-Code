import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleTrigger } from "@/components/ui"

import { StyledMarkdown } from "./styles"

export const ModelDescriptionMarkdown = memo(
	({
		markdown = "",
		key,
		isExpanded,
		setIsExpanded,
	}: {
		markdown?: string
		key: string
		isExpanded: boolean
		setIsExpanded: (isExpanded: boolean) => void
	}) => {
		const [isExpandable, setIsExpandable] = useState(false)
		const textContainerRef = useRef<HTMLDivElement>(null)
		const textRef = useRef<HTMLDivElement>(null)

		useEffect(() => {
			if (textRef.current && textContainerRef.current) {
				setIsExpandable(textRef.current.scrollHeight > textContainerRef.current.clientHeight)
			}
		}, [markdown])

		return (
			<Collapsible open={isExpanded} onOpenChange={setIsExpanded} className="relative">
				<div ref={textContainerRef} className={cn({ "line-clamp-4": !isExpanded })}>
					<div ref={textRef}>
						<StyledMarkdown key={key}>
							{/* Same markdown stack as MarkdownBlock; singleTilde: false keeps "1~3" literal. */}
							<ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }]]}>
								{markdown}
							</ReactMarkdown>
						</StyledMarkdown>
					</div>
				</div>
				<CollapsibleTrigger asChild className={cn({ hidden: !isExpandable })}>
					<VSCodeLink className="text-sm">{isExpanded ? "Less" : "More"}</VSCodeLink>
				</CollapsibleTrigger>
			</Collapsible>
		)
	},
)
