import React, { useEffect, useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { vscode } from "@src/utils/vscode"
import i18next, { loadTranslations } from "@src/i18n/setup"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { TranslationProvider } from "@src/i18n/TranslationContext"
import { TooltipProvider } from "@src/components/ui/tooltip"
import { STANDARD_TOOLTIP_DELAY } from "@src/components/ui/standard-tooltip"
import ErrorBoundary from "@src/components/ErrorBoundary"

import { PlanReviewSurface } from "./PlanReviewSurface"

interface PlanReviewState {
	filePath?: string
	markdown?: string
	language?: string
}

const queryClient = new QueryClient()

const PlanReviewAppInner: React.FC = () => {
	const { t } = useTranslation()
	const [state, setState] = useState<PlanReviewState | null>(null)
	// Bumped when a content-mode init brings a different document, so the
	// surface remounts and stale annotations don't leak onto the new plan.
	const [contentSession, setContentSession] = useState(0)
	// Bumped when the host consumed the draft notes (e.g. the user clicked
	// Approve on the pending review ask) — clears the surface's drafts.
	const [draftsResetSignal, setDraftsResetSignal] = useState(0)

	// Load translations on mount.
	useEffect(() => {
		try {
			loadTranslations()
		} catch (error) {
			console.error("Failed to load translations:", error)
		}
	}, [])

	// Post ready message on mount.
	useEffect(() => {
		vscode.postMessage({ type: "planReviewReady" })
	}, [])

	// Listen for init/update messages from the extension host.
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message = event.data
			if (!message) return

			if (message.type === "planReviewInit") {
				const planReview = message.planReview as PlanReviewState
				if (planReview?.language) {
					i18next.changeLanguage(planReview.language)
				}
				setState((prev) => {
					// A content-mode re-init with a different document must not
					// inherit the previous document's annotations.
					if (prev && !planReview.filePath && prev.markdown !== planReview.markdown) {
						setContentSession((s) => s + 1)
					}
					return planReview
				})
			} else if (message.type === "planReviewUpdate") {
				const planReview = message.planReview as PlanReviewState
				if (planReview) {
					// Update markdown only — preserve annotation state.
					setState((prev) => ({ ...prev, markdown: planReview.markdown }))
				}
			} else if (message.type === "planReviewDraftsConsumed") {
				setDraftsResetSignal((s) => s + 1)
			}
		}

		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	const handleSubmit = useCallback((text: string) => {
		vscode.postMessage({ type: "planReviewSubmit", text })
	}, [])

	const handleClose = useCallback(() => {
		vscode.postMessage({ type: "planReviewClose" })
	}, [])

	const handleDraftsChanged = useCallback((compiledText: string, count: number) => {
		vscode.postMessage({ type: "planReviewDraftsChanged", text: compiledText, values: { count } })
	}, [])

	if (!state) {
		return (
			<div className="fixed inset-0 flex items-center justify-center">
				<p className="text-sm text-vscode-descriptionForeground">{t("chat:planReview.loading")}</p>
			</div>
		)
	}

	return (
		<PlanReviewSurface
			key={state.filePath ?? `content-${contentSession}`}
			markdown={state.markdown ?? ""}
			filePath={state.filePath}
			onSubmit={handleSubmit}
			onClose={handleClose}
			onDraftsChanged={handleDraftsChanged}
			resetSignal={draftsResetSignal}
		/>
	)
}

const PlanReviewApp: React.FC = () => {
	return (
		<ErrorBoundary>
			<ExtensionStateContextProvider>
				<TranslationProvider>
					<QueryClientProvider client={queryClient}>
						<TooltipProvider delayDuration={STANDARD_TOOLTIP_DELAY}>
							<PlanReviewAppInner />
						</TooltipProvider>
					</QueryClientProvider>
				</TranslationProvider>
			</ExtensionStateContextProvider>
		</ErrorBoundary>
	)
}

export default PlanReviewApp
