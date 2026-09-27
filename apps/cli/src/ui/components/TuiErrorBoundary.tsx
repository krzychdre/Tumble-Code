import { Component, type ErrorInfo, type ReactNode } from "react"
import { Text } from "ink"

/**
 * Error boundary around the whole TUI (R6). A render crash in any component
 * used to leave ink's renderer running over a broken tree: the terminal
 * stayed in raw mode and the user saw ink's raw error dump (or nothing at
 * all). The boundary replaces the tree with a readable message, keeps the
 * "Ctrl+C to exit" affordance alive (the crash path also unmounts via the
 * process guards) and hands the error to `onError` — run.ts passes the
 * guard error emitter so the crash is reported once, in the right place.
 *
 * Deliberately minimal compared with the webview ErrorBoundary: no i18n, no
 * telemetry, no source-map lookup — the CLI cannot assume either is up.
 */
interface ErrorBoundaryProps {
	/** Optional only so `createElement(type, props, child)` type-checks. */
	children?: ReactNode
	/** Called once when a render error is caught. */
	onError?: (error: Error, info: ErrorInfo) => void
}

interface ErrorBoundaryState {
	error?: Error
}

export class TuiErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	state: ErrorBoundaryState = {}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error }
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		this.props.onError?.(error, info)
	}

	render(): ReactNode {
		if (!this.state.error) {
			return this.props.children
		}

		const { name, message, stack } = this.state.error

		return (
			<Text>
				{`${name}: ${message}`}
				{stack ? `\n${stack}` : ""}
				{"\nSomething went wrong in the TUI. Press Ctrl+C to exit."}
			</Text>
		)
	}
}
