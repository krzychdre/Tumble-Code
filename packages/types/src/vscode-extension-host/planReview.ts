/*
 * Extension host channel, planReview domain: the webview requests handled by
 * src/core/webview/PlanReviewPanel.ts and the host to view
 * messages of the same domain.
 */

/** Plan review panel, handled by PlanReviewPanel rather than the router. */
export type PlanReviewWebviewMessageType =
	| "planReviewReady"
	| "planReviewSubmit"
	| "planReviewClose"
	| "planReviewDraftsChanged"

/** Plan review panel content and draft state. */
export type PlanReviewExtensionMessageType = "planReviewInit" | "planReviewUpdate" | "planReviewDraftsConsumed"
