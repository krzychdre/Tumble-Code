import { StrictMode, Suspense, lazy } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App"
import "../node_modules/@vscode/codicons/dist/codicon.css"

import { getHighlighter } from "./utils/highlighter"

// Initialize Shiki early to hide initialization latency (async)
getHighlighter().catch((error: Error) => console.error("Failed to initialize Shiki highlighter:", error))

// The plan review panel is the only user of PlanReviewApp: keep it out of the
// main panel's startup bundle.
const PlanReviewApp = lazy(() => import("./components/plan-review/PlanReviewApp"))

const isPlanReviewMode = !!(window as Window & { PLAN_REVIEW_MODE?: boolean }).PLAN_REVIEW_MODE

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		{isPlanReviewMode ? (
			<Suspense fallback={null}>
				<PlanReviewApp />
			</Suspense>
		) : (
			<App />
		)}
	</StrictMode>,
)
