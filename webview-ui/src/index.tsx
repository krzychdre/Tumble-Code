import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App"
import PlanReviewApp from "./components/plan-review/PlanReviewApp"
import "../node_modules/@vscode/codicons/dist/codicon.css"

import { getHighlighter } from "./utils/highlighter"

// Initialize Shiki early to hide initialization latency (async)
getHighlighter().catch((error: Error) => console.error("Failed to initialize Shiki highlighter:", error))

const isPlanReviewMode = !!(window as Window & { PLAN_REVIEW_MODE?: boolean }).PLAN_REVIEW_MODE

createRoot(document.getElementById("root")!).render(
	<StrictMode>{isPlanReviewMode ? <PlanReviewApp /> : <App />}</StrictMode>,
)
