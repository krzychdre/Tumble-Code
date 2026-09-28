import React, { memo, useEffect, useMemo, useSyncExternalStore } from "react"
import ReactMarkdown from "react-markdown"
import { visit } from "unist-util-visit"
import remarkMath from "remark-math"
import remarkGfm from "remark-gfm"

import { vscode } from "@src/utils/vscode"
import { type AlertType, markdownUrlTransform, remarkGithubAlerts, remarkSingleDollarMath } from "@src/utils/markdown"
import { decodeFilePath, isWindowsAbsolutePath, toOpenFileLinkText } from "@src/utils/windows-file-links"

import CodeBlock from "./CodeBlock"
import MermaidBlock from "./MermaidBlock"

// Codicon glyphs used as the leading icon for each GitHub-style alert type.
const ALERT_ICONS: Record<AlertType, string> = {
	note: "codicon-info",
	tip: "codicon-lightbulb",
	important: "codicon-report",
	warning: "codicon-warning",
	caution: "codicon-flame",
}

// Human-readable label shown in the alert header.
const ALERT_LABELS: Record<AlertType, string> = {
	note: "Note",
	tip: "Tip",
	important: "Important",
	warning: "Warning",
	caution: "Caution",
}

// KaTeX (through rehype-katex) and its stylesheet are imported the first time
// a message may contain math, so both stay out of the startup bundle (the CSS
// used to ride the eager index.css import). remark-math still parses "$...$"
// eagerly; until the plugin has loaded, a formula shows as its TeX source.
type RehypeKatex = (typeof import("rehype-katex"))["default"]

let rehypeKatex: RehypeKatex | undefined
let rehypeKatexLoad: Promise<void> | undefined
const rehypeKatexListeners = new Set<() => void>()

const loadRehypeKatex = () => {
	rehypeKatexLoad ??= Promise.all([
		// Dynamic CSS import: the bundler emits the stylesheet as its own
		// chunk and injects a <link> only when this runs.
		import("katex/dist/katex.min.css"),
		import("rehype-katex"),
	]).then(
		([, module]) => {
			rehypeKatex = module.default
			rehypeKatexListeners.forEach((listener) => listener())
		},
		(error) => {
			rehypeKatexLoad = undefined
			console.warn("Failed to load KaTeX:", error)
		},
	)

	return rehypeKatexLoad
}

const subscribeRehypeKatex = (listener: () => void) => {
	rehypeKatexListeners.add(listener)
	return () => {
		rehypeKatexListeners.delete(listener)
	}
}

const getRehypeKatex = () => rehypeKatex

// remark-math only recognises "$" delimiters, so markdown without "$" has no math.
const useRehypeKatex = (markdown: string) => {
	const plugin = useSyncExternalStore(subscribeRehypeKatex, getRehypeKatex)
	const mayContainMath = markdown.includes("$")

	useEffect(() => {
		if (mayContainMath && !plugin) {
			loadRehypeKatex()
		}
	}, [mayContainMath, plugin])

	return plugin
}

interface MarkdownBlockProps {
	markdown?: string
}

const MarkdownBlock = memo(({ markdown }: MarkdownBlockProps) => {
	const rehypeKatexPlugin = useRehypeKatex(markdown ?? "")
	const components = useMemo(
		() => ({
			table: ({ children, ...props }: any) => {
				return (
					<div className="table-wrapper">
						<table {...props}>{children}</table>
					</div>
				)
			},
			a: ({ href, children, ...props }: any) => {
				const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
					// Only process file:// protocol or local file paths (including
					// Windows drive/UNC paths, which contain no "://").
					const isLocalPath =
						href?.startsWith("file://") ||
						href?.startsWith("/") ||
						isWindowsAbsolutePath(href ?? "") ||
						!href?.includes("://")

					if (!isLocalPath) {
						return
					}

					e.preventDefault()

					// Handle absolute vs project-relative paths. file:///C:/a.ts
					// must strip exactly the "file://" scheme prefix (one slash),
					// then drop the now-leading slash before the drive letter.
					// Markdown percent-encodes backslashes (C:\Users arrives as
					// C:%5CUsers), so decode before classifying the path.
					let filePath = decodeFilePath(href.replace(/^file:\/\//, ""))
					if (/^\/[a-zA-Z]:[\\/]/.test(filePath)) {
						filePath = filePath.slice(1)
					}

					// Extract line number if present
					const match = filePath.match(/(.*):(\d+)(-\d+)?$/)
					let values = undefined
					if (match) {
						filePath = match[1]
						values = { line: parseInt(match[2]) }
					}

					filePath = toOpenFileLinkText(filePath)

					vscode.postMessage({
						type: "openFile",
						text: filePath,
						values,
					})
				}

				return (
					<a {...props} href={href} onClick={handleClick}>
						{children}
					</a>
				)
			},
			pre: ({ children, ..._props }: any) => {
				// The structure from react-markdown v9 is: pre > code > text
				const codeEl = children as React.ReactElement<{ className?: string; children?: React.ReactNode }>

				if (!codeEl || !codeEl.props) {
					return <pre>{children}</pre>
				}

				const { className = "", children: codeChildren } = codeEl.props

				// Get the actual code text
				let codeString = ""
				if (typeof codeChildren === "string") {
					codeString = codeChildren
				} else if (Array.isArray(codeChildren)) {
					codeString = codeChildren.filter((child) => typeof child === "string").join("")
				}

				// Handle mermaid diagrams
				if (className.includes("language-mermaid")) {
					return (
						<div style={{ margin: "1em 0" }}>
							<MermaidBlock code={codeString} />
						</div>
					)
				}

				// Extract language from className
				const match = /language-(\w+)/.exec(className)
				const language = match ? match[1] : "text"

				// Wrap CodeBlock in a div to ensure proper separation
				return (
					<div style={{ margin: "1em 0" }}>
						<CodeBlock source={codeString} language={language} />
					</div>
				)
			},
			code: ({ children, className, ...props }: any) => {
				// This handles inline code
				return (
					<code className={className} {...props}>
						{children}
					</code>
				)
			},
			blockquote: ({ children, className, "data-alert-type": alertType, ..._rest }: any) => {
				// The remarkGithubAlerts plugin tags alert blockquotes with a
				// `data-alert-type` attribute and `markdown-alert*` classes.
				// Anything without that attribute is a normal blockquote and
				// must render unchanged.
				const typedAlertType = alertType as AlertType | undefined

				if (!typedAlertType || !(typedAlertType in ALERT_ICONS)) {
					return <blockquote className={className}>{children}</blockquote>
				}

				return (
					<blockquote className={className} data-alert-type={typedAlertType}>
						<div className="markdown-alert-title">
							<span className={`codicon ${ALERT_ICONS[typedAlertType]}`} aria-hidden="true" />
							<span>{ALERT_LABELS[typedAlertType]}</span>
						</div>
						{children}
					</blockquote>
				)
			},
		}),
		[],
	)

	return (
		// The look comes from the `.markdown-block` rules in the content-blocks
		// section of index.css.
		<div className="markdown-block">
			<ReactMarkdown
				remarkPlugins={[
					// singleTilde: false so a single "~" around text (e.g. "1~3", "~10") is not
					// rendered as strikethrough; only "~~text~~" is. Matches VS Code's markdown. (#154)
					[remarkGfm, { singleTilde: false }],
					// "$$...$$" stays with remark-math; "$...$" follows Pandoc's rule so prices stay text.
					[remarkMath, { singleDollarTextMath: false }],
					remarkSingleDollarMath,
					remarkGithubAlerts,
					() => {
						return (tree: any) => {
							visit(tree, "code", (node: any) => {
								if (!node.lang) {
									node.lang = "text"
								} else if (node.lang.includes(".")) {
									node.lang = node.lang.split(".").slice(-1)[0]
								}
							})
						}
					},
				]}
				rehypePlugins={rehypeKatexPlugin ? [rehypeKatexPlugin as any] : []}
				// Keeps file:// and "name.ext:line" hrefs for the click handler above.
				urlTransform={markdownUrlTransform}
				components={components}>
				{markdown || ""}
			</ReactMarkdown>
		</div>
	)
})

export default MarkdownBlock
