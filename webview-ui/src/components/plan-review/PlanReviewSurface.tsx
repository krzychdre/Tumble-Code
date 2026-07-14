import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { X, Plus, Pencil, Trash2 } from "lucide-react"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, StandardTooltip } from "@src/components/ui"
import MarkdownBlock from "../common/MarkdownBlock"

import { compilePlanReviewMessage, type PlanAnnotation } from "./planReviewMessage"

interface PlanReviewSurfaceProps {
	markdown: string
	filePath?: string
	onClose: () => void
	onSubmit: (compiledText: string) => void
}

/**
 * Best-effort highlight of annotated quotes using the CSS Custom Highlight API.
 * Wrapped in try/catch so failures (e.g. jsdom) are contained.
 */
function highlightAnnotations(container: HTMLElement, annotations: PlanAnnotation[]) {
	try {
		if (typeof CSS === "undefined" || !("highlights" in CSS)) return

		// Collect all text nodes and build a concatenated string with offset map.
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)
		const textNodes: { node: Text; start: number; end: number }[] = []
		let offset = 0
		let n: Node | null
		while ((n = walker.nextNode())) {
			const text = n as Text
			textNodes.push({ node: text, start: offset, end: offset + text.textContent!.length })
			offset += text.textContent!.length
		}
		const fullText = textNodes.map((tn) => tn.node.textContent!).join("")

		// Normalize whitespace in full text for matching.
		const normalizedFull = fullText.replace(/\s+/g, " ")

		// Build a mapping from normalized positions to original positions.
		// We build a parallel array of original indices for each normalized char.
		const origIndices: number[] = []
		let lastWasSpace = false
		for (let i = 0; i < fullText.length; i++) {
			const ch = fullText[i]
			if (/\s/.test(ch)) {
				if (!lastWasSpace) {
					origIndices.push(i)
					lastWasSpace = true
				}
			} else {
				origIndices.push(i)
				lastWasSpace = false
			}
		}

		const ranges: Range[] = []

		for (const ann of annotations) {
			const normalizedQuote = ann.quote.replace(/\s+/g, " ").trim()
			if (!normalizedQuote) continue

			const idx = normalizedFull.indexOf(normalizedQuote)
			if (idx === -1) continue

			// Map normalized indices back to original indices.
			const origStart = origIndices[idx]
			const origEnd = origIndices[idx + normalizedQuote.length - 1] + 1

			// Find the text nodes that contain the start and end offsets.
			const startNode = textNodes.find((tn) => tn.start <= origStart && tn.end > origStart)
			const endNode = textNodes.find((tn) => tn.start < origEnd && tn.end >= origEnd)
			if (!startNode || !endNode) continue

			const range = document.createRange()
			range.setStart(startNode.node, origStart - startNode.start)
			range.setEnd(endNode.node, origEnd - endNode.start)
			ranges.push(range)
		}

		const highlight = new Highlight(...ranges)
		CSS.highlights.set("plan-review-annotation", highlight)
	} catch {
		// Silently skip — highlighting is cosmetic.
	}
}

function clearHighlights() {
	try {
		if (typeof CSS === "undefined" || !("highlights" in CSS)) return
		CSS.highlights.delete("plan-review-annotation")
	} catch {
		// ignore
	}
}

export const PlanReviewSurface: React.FC<PlanReviewSurfaceProps> = ({ markdown, filePath, onClose, onSubmit }) => {
	const { t } = useAppTranslation()

	const [annotations, setAnnotations] = useState<PlanAnnotation[]>([])
	const [overallComment, setOverallComment] = useState("")
	const [showNoteEditor, setShowNoteEditor] = useState(false)
	const [noteEditorText, setNoteEditorText] = useState("")
	const [pendingQuote, setPendingQuote] = useState("")
	const [candidateQuote, setCandidateQuote] = useState("")
	const [chipPos, setChipPos] = useState<{ x: number; y: number } | null>(null)
	const [editorPos, setEditorPos] = useState<{ x: number; y: number } | null>(null)
	const [editingId, setEditingId] = useState<string | null>(null)
	const [editingText, setEditingText] = useState("")
	const [isWide, setIsWide] = useState(false)

	const rootRef = useRef<HTMLDivElement>(null)
	const markdownRef = useRef<HTMLDivElement>(null)
	const chipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Responsive layout: side column when wide, bottom section when narrow.
	useLayoutEffect(() => {
		const el = rootRef.current
		if (!el) return
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width ?? 0
			setIsWide(w >= 640)
		})
		ro.observe(el)
		return () => ro.disconnect()
	}, [])

	// Re-run highlights when annotations change.
	useLayoutEffect(() => {
		const container = markdownRef.current
		if (!container) return
		clearHighlights()
		if (annotations.length > 0) {
			highlightAnnotations(container, annotations)
		}
		return () => clearHighlights()
	}, [annotations])

	// Inject the CSS highlight rule once.
	useLayoutEffect(() => {
		const styleId = "plan-review-highlight-style"
		if (document.getElementById(styleId)) return
		const style = document.createElement("style")
		style.id = styleId
		style.textContent = `::highlight(plan-review-annotation) { background-color: color-mix(in srgb, var(--vscode-editor-findMatchHighlightBackground, #ea5c0044) 50%, transparent); }`
		document.head.appendChild(style)
		return () => {
			document.getElementById(styleId)?.remove()
		}
	}, [])

	const handleMouseUp = useCallback(() => {
		// Ignore selection changes while a note is being written (e.g. clicks
		// inside the editor textarea also bubble a mouseup from the container).
		if (showNoteEditor) return
		if (chipTimerRef.current) {
			clearTimeout(chipTimerRef.current)
		}
		// Small delay to let selection settle.
		chipTimerRef.current = setTimeout(() => {
			const container = markdownRef.current
			if (!container) return
			const sel = window.getSelection()
			if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
				setChipPos(null)
				return
			}
			const range = sel.getRangeAt(0)
			// Check that selection is within the markdown container.
			if (!container.contains(range.commonAncestorContainer)) {
				setChipPos(null)
				return
			}
			const quote = sel.toString().trim().replace(/\s+/g, " ")
			if (!quote) {
				setChipPos(null)
				return
			}
			const rect = range.getBoundingClientRect()
			if (rect.width === 0 && rect.height === 0) {
				setChipPos(null)
				return
			}
			const containerRect = container.getBoundingClientRect()
			// Position relative to the container's scrolled content, clamped.
			const x = Math.max(
				0,
				Math.min(
					rect.left - containerRect.left + container.scrollLeft + rect.width / 2 - 40,
					container.clientWidth - 80,
				),
			)
			const y = Math.max(0, rect.top - containerRect.top + container.scrollTop - 40)
			// The quote is captured here because clicking the chip collapses the
			// browser selection before the click handler runs.
			setCandidateQuote(quote)
			setChipPos({ x, y })
		}, 10)
	}, [showNoteEditor])

	const handleAddNote = useCallback(() => {
		if (!candidateQuote || !chipPos) {
			setChipPos(null)
			return
		}
		setPendingQuote(candidateQuote)
		setNoteEditorText("")
		setEditorPos(chipPos)
		setShowNoteEditor(true)
		setChipPos(null)
	}, [candidateQuote, chipPos])

	const handleSaveNote = useCallback(() => {
		const note = noteEditorText.trim()
		if (!note || !pendingQuote) {
			setShowNoteEditor(false)
			setPendingQuote("")
			return
		}
		setAnnotations((prev) => [...prev, { id: crypto.randomUUID(), quote: pendingQuote, note }])
		setShowNoteEditor(false)
		setPendingQuote("")
		setNoteEditorText("")
		// Clear browser selection.
		window.getSelection()?.removeAllRanges()
	}, [noteEditorText, pendingQuote])

	const handleCancelNote = useCallback(() => {
		setShowNoteEditor(false)
		setPendingQuote("")
		setNoteEditorText("")
	}, [])

	const handleDelete = useCallback((id: string) => {
		setAnnotations((prev) => prev.filter((a) => a.id !== id))
	}, [])

	const handleStartEdit = useCallback((id: string, currentNote: string) => {
		setEditingId(id)
		setEditingText(currentNote)
	}, [])

	const handleSaveEdit = useCallback(() => {
		if (!editingId) return
		const trimmed = editingText.trim()
		if (trimmed) {
			setAnnotations((prev) => prev.map((a) => (a.id === editingId ? { ...a, note: trimmed } : a)))
		}
		setEditingId(null)
		setEditingText("")
	}, [editingId, editingText])

	const handleCancelEdit = useCallback(() => {
		setEditingId(null)
		setEditingText("")
	}, [])

	const canSend = annotations.length > 0 || overallComment.trim().length > 0

	const handleSend = useCallback(() => {
		const compiled = compilePlanReviewMessage(annotations, overallComment, filePath)
		onSubmit(compiled)
	}, [annotations, overallComment, filePath, onSubmit])

	const annotationsPanel = useMemo(() => {
		return (
			<div className="flex flex-col gap-2 overflow-y-auto h-full">
				{annotations.length === 0 ? (
					<p className="text-sm text-vscode-descriptionForeground p-2">{t("chat:planReview.emptyState")}</p>
				) : (
					annotations.map((ann) => (
						<div
							key={ann.id}
							className="border border-vscode-editorWidget-border rounded p-2 flex flex-col gap-1">
							<blockquote
								className="border-l-2 border-vscode-textLink-foreground pl-2 text-xs text-vscode-descriptionForeground line-clamp-3"
								style={{
									overflow: "hidden",
									display: "-webkit-box",
									WebkitLineClamp: 3,
									WebkitBoxOrient: "vertical",
								}}>
								{ann.quote}
							</blockquote>
							{editingId === ann.id ? (
								<div className="flex flex-col gap-1">
									<textarea
										className="w-full text-sm bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded p-1"
										rows={2}
										value={editingText}
										onChange={(e) => setEditingText(e.target.value)}
										autoFocus
									/>
									<div className="flex gap-1">
										<Button variant="primary" size="sm" onClick={handleSaveEdit}>
											{t("chat:planReview.save")}
										</Button>
										<Button variant="secondary" size="sm" onClick={handleCancelEdit}>
											{t("chat:planReview.cancel")}
										</Button>
									</div>
								</div>
							) : (
								<>
									<p className="text-sm">{ann.note}</p>
									<div className="flex gap-1">
										<StandardTooltip content={t("chat:planReview.editNote")}>
											<button
												className="cursor-pointer p-1 hover:bg-vscode-list-hoverBackground rounded"
												onClick={() => handleStartEdit(ann.id, ann.note)}
												aria-label={t("chat:planReview.editNote")}>
												<Pencil className="w-3.5 h-3.5" />
											</button>
										</StandardTooltip>
										<StandardTooltip content={t("chat:planReview.deleteNote")}>
											<button
												className="cursor-pointer p-1 hover:bg-vscode-list-hoverBackground rounded"
												onClick={() => handleDelete(ann.id)}
												aria-label={t("chat:planReview.deleteNote")}>
												<Trash2 className="w-3.5 h-3.5" />
											</button>
										</StandardTooltip>
									</div>
								</>
							)}
						</div>
					))
				)}
			</div>
		)
	}, [annotations, editingId, editingText, t, handleSaveEdit, handleCancelEdit, handleStartEdit, handleDelete])

	return (
		<div
			ref={rootRef}
			className="h-full w-full flex flex-col"
			style={{ background: "var(--vscode-editor-background)" }}>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-2 border-b border-vscode-editorWidget-border shrink-0">
				<div className="flex items-baseline gap-2 min-w-0">
					<h2 className="text-base font-bold shrink-0">{t("chat:planReview.title")}</h2>
					{filePath && (
						<code className="text-xs text-vscode-descriptionForeground truncate" title={filePath}>
							{filePath}
						</code>
					)}
				</div>
				<button
					className="cursor-pointer p-1 hover:bg-vscode-list-hoverBackground rounded shrink-0"
					onClick={onClose}
					aria-label={t("chat:planReview.cancel")}>
					<X className="w-5 h-5" />
				</button>
			</div>

			{/* Main area */}
			<div className={isWide ? "flex flex-row flex-1 overflow-hidden" : "flex flex-col flex-1 overflow-hidden"}>
				{/* Markdown rendering area */}
				<div
					ref={markdownRef}
					className={isWide ? "flex-1 overflow-y-auto p-4 relative" : "flex-1 overflow-y-auto p-4 relative"}
					onMouseUp={handleMouseUp}
					style={{ position: "relative" }}>
					<MarkdownBlock markdown={markdown} />

					{/* Floating "Add note" chip */}
					{chipPos && !showNoteEditor && (
						<button
							className="absolute z-10 flex items-center gap-1 px-2 py-1 text-xs rounded shadow-lg cursor-pointer"
							style={{
								left: chipPos.x,
								top: chipPos.y,
								background: "var(--vscode-button-background)",
								color: "var(--vscode-button-foreground)",
							}}
							// Keep the text selection visible while clicking the chip.
							onMouseDown={(e) => e.preventDefault()}
							onClick={handleAddNote}>
							<Plus className="w-3 h-3" />
							{t("chat:planReview.addNote")}
						</button>
					)}

					{/* Inline note editor */}
					{showNoteEditor && editorPos && (
						<div
							className="absolute z-20 flex flex-col gap-1 p-2 rounded shadow-xl"
							style={{
								left: editorPos.x,
								top: editorPos.y,
								background: "var(--vscode-editor-background)",
								border: "1px solid var(--vscode-editorWidget-border)",
								minWidth: 240,
							}}>
							<textarea
								className="w-full text-sm bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded p-1"
								rows={3}
								placeholder={t("chat:planReview.notePlaceholder")}
								value={noteEditorText}
								onChange={(e) => setNoteEditorText(e.target.value)}
								autoFocus
							/>
							<div className="flex gap-1 justify-end">
								<Button variant="primary" size="sm" onClick={handleSaveNote}>
									{t("chat:planReview.save")}
								</Button>
								<Button variant="secondary" size="sm" onClick={handleCancelNote}>
									{t("chat:planReview.cancel")}
								</Button>
							</div>
						</div>
					)}
				</div>

				{/* Notes panel */}
				<div
					className={
						isWide
							? "w-72 border-l border-vscode-editorWidget-border p-2 shrink-0 overflow-hidden"
							: "max-h-[200px] border-t border-vscode-editorWidget-border p-2 shrink-0"
					}>
					{annotationsPanel}
				</div>
			</div>

			{/* Footer */}
			<div className="flex items-end gap-2 px-4 py-2 border-t border-vscode-editorWidget-border shrink-0">
				<textarea
					className="flex-1 text-sm bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded p-2 resize-none"
					rows={2}
					placeholder={t("chat:planReview.overallPlaceholder")}
					value={overallComment}
					onChange={(e) => setOverallComment(e.target.value)}
				/>
				<div className="flex gap-2">
					<Button variant="secondary" onClick={onClose}>
						{t("chat:planReview.cancel")}
					</Button>
					<Button variant="primary" disabled={!canSend} onClick={handleSend}>
						{t("chat:planReview.send")}
					</Button>
				</div>
			</div>
		</div>
	)
}
