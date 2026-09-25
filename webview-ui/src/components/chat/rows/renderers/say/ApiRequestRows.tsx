import { useTranslation } from "react-i18next"
import { Repeat2 } from "lucide-react"

import type { ClineApiReqInfo } from "@roo-code/types"

import { safeJsonParse } from "@roo-code/core/browser"

import { cn } from "@/lib/utils"
import ErrorRow from "@src/components/chat/ErrorRow"
import { BlockTimestamp } from "@src/components/chat/BlockTimestamp"
import { ProgressIndicator } from "@src/components/chat/ProgressIndicator"

import { cancelledColor, errorColor, headerStyle, normalColor } from "../shared"
import type { RowRendererProps } from "../types"

const iconSpan = (iconName: string, color: string) => (
	<div
		style={{
			width: 16,
			height: 16,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
		}}>
		<span className={`codicon codicon-${iconName}`} style={{ color, fontSize: 16, marginBottom: "-1.5px" }} />
	</div>
)

/** One API request: its status, duration and cost, and the error when it failed. */
export const ApiReqStartedRow = ({ message, isLast, lastModifiedMessage, meta }: RowRendererProps) => {
	const { t } = useTranslation()

	const info =
		message.text !== null && message.text !== undefined ? safeJsonParse<ClineApiReqInfo>(message.text) : undefined
	const cost = info?.cost
	const apiReqCancelReason = info?.cancelReason
	const apiReqStreamingFailedMessage = info?.streamingFailedMessage

	// When resuming task, last won't be api_req_failed but a resume_task
	// message, so api_req_started will show loading spinner. That's why we just
	// remove the last api_req_started that failed without streaming anything.
	const apiRequestFailedMessage =
		isLast && lastModifiedMessage?.ask === "api_req_failed" // if request is retried then the latest message is a api_req_retried
			? lastModifiedMessage?.text
			: undefined

	const icon =
		apiReqCancelReason !== null && apiReqCancelReason !== undefined ? (
			apiReqCancelReason === "user_cancelled" ? (
				iconSpan("error", cancelledColor)
			) : (
				iconSpan("error", errorColor)
			)
		) : cost !== null && cost !== undefined ? (
			iconSpan("arrow-swap", normalColor)
		) : apiRequestFailedMessage ? (
			iconSpan("error", errorColor)
		) : isLast ? (
			<ProgressIndicator />
		) : (
			iconSpan("arrow-swap", normalColor)
		)

	const title =
		apiReqCancelReason !== null && apiReqCancelReason !== undefined ? (
			apiReqCancelReason === "user_cancelled" ? (
				<span style={{ color: normalColor, fontWeight: "bold" }}>{t("chat:apiRequest.cancelled")}</span>
			) : (
				<span style={{ color: errorColor, fontWeight: "bold" }}>{t("chat:apiRequest.streamingFailed")}</span>
			)
		) : cost !== null && cost !== undefined ? (
			<span style={{ color: normalColor, fontWeight: "bold" }}>{t("chat:apiRequest.title")}</span>
		) : apiRequestFailedMessage ? (
			<span style={{ color: errorColor, fontWeight: "bold" }}>{t("chat:apiRequest.failed")}</span>
		) : (
			<span style={{ color: normalColor, fontWeight: "bold" }}>{t("chat:apiRequest.streaming")}</span>
		)

	// Determine if the API request is in progress
	const isApiRequestInProgress =
		apiReqCancelReason === undefined && apiRequestFailedMessage === undefined && cost === undefined

	return (
		<>
			<div
				className="group text-sm"
				style={{
					...headerStyle,
					marginBottom:
						((cost === null || cost === undefined) && apiRequestFailedMessage) ||
						apiReqStreamingFailedMessage
							? 10
							: 0,
					justifyContent: "space-between",
				}}>
				<div style={{ display: "flex", alignItems: "center", gap: "10px", flexGrow: 1 }}>
					{icon}
					{title}
					<BlockTimestamp
						startTs={message.ts}
						endTs={isApiRequestInProgress ? undefined : meta.nextTs}
						live={isApiRequestInProgress}
					/>
				</div>
				<div
					className="text-xs text-vscode-dropdown-foreground border-vscode-dropdown-border/50 border px-1.5 py-0.5 rounded-lg"
					style={{ opacity: cost !== null && cost !== undefined && cost > 0 ? 1 : 0 }}>
					${Number(cost || 0)?.toFixed(4)}
				</div>
			</div>
			{(((cost === null || cost === undefined) && apiRequestFailedMessage) || apiReqStreamingFailedMessage) && (
				<ErrorRow
					type="api_failure"
					message={apiRequestFailedMessage || apiReqStreamingFailedMessage || ""}
					docsURL={
						apiRequestFailedMessage?.toLowerCase().includes("powershell")
							? "https://github.com/cline/cline/wiki/TroubleShooting-%E2%80%90-%22PowerShell-is-not-recognized-as-an-internal-or-external-command%22"
							: undefined
					}
					errorDetails={apiReqStreamingFailedMessage}
				/>
			)}
		</>
	)
}

/** A failed request that is retried after a delay, with the countdown. */
export const ApiReqRetryDelayedRow = ({ message }: RowRendererProps) => {
	const { t, i18n } = useTranslation()

	let body = t(`chat:apiRequest.failed`)
	let retryInfo, rawError, code, docsURL
	if (message.text !== undefined) {
		// Try to show richer error message for that code, if available
		const potentialCode = parseInt(message.text.substring(0, 3))
		if (!isNaN(potentialCode) && potentialCode >= 400) {
			code = potentialCode
			const stringForError = `chat:apiRequest.errorMessage.${code}`
			if (i18n.exists(stringForError)) {
				body = t(stringForError)
				// Fill this out in upcoming PRs
				// Do not remove this
				// switch(code) {
				// 	case ERROR_CODE:
				// 		docsURL = ???
				// 		break;
				// }
			} else {
				// Non-HTTP-status-code error message - store full text as errorDetails
				body = t("chat:apiRequest.errorMessage.unknown")
				docsURL =
					"mailto:support@roocode.com?subject=Unknown API Error&body=[Please include full error details]"
			}
		}

		// This isn't pretty, but since the retry logic happens at a lower level
		// and the message object is just a flat string, we need to extract the
		// retry information using this "tag" as a convention
		const retryTimerMatch = message.text.match(/<retry_timer>(.*?)<\/retry_timer>/)
		const retryTimer = retryTimerMatch && retryTimerMatch[1] ? parseInt(retryTimerMatch[1], 10) : 0
		rawError = message.text.replace(/<retry_timer>(.*?)<\/retry_timer>/, "").trim()
		retryInfo = retryTimer > 0 && (
			<p
				className={cn(
					"mt-2 font-light text-xs  text-vscode-descriptionForeground cursor-default flex items-center gap-1 transition-all duration-1000",
					retryTimer === 0 ? "opacity-0 max-h-0" : "max-h-2 opacity-100",
				)}>
				<Repeat2 className="size-3" strokeWidth={1.5} />
				<span>{retryTimer}s</span>
			</p>
		)
	}
	return (
		<ErrorRow
			type="api_req_retry_delayed"
			code={code}
			message={body}
			docsURL={docsURL}
			additionalContent={retryInfo}
			errorDetails={rawError}
		/>
	)
}

// Outside the component: the React Compiler cannot compile a conditional inside try/catch.
const parseWaitSeconds = (text: string | undefined): number | undefined => {
	if (!text) return undefined
	try {
		const data = JSON.parse(text)
		return typeof data.seconds === "number" ? data.seconds : undefined
	} catch {
		return undefined
	}
}

/** The wait before a request when the provider's rate limit applies. */
export const ApiReqRateLimitWaitRow = ({ message }: RowRendererProps) => {
	const { t } = useTranslation()
	const isWaiting = message.partial === true

	const waitSeconds = parseWaitSeconds(message.text)

	return isWaiting && waitSeconds !== undefined ? (
		<div
			className={`group text-sm transition-opacity opacity-100`}
			style={{
				...headerStyle,
				marginBottom: 0,
				justifyContent: "space-between",
			}}>
			<div style={{ display: "flex", alignItems: "center", gap: "10px", flexGrow: 1 }}>
				<ProgressIndicator />
				<span style={{ color: normalColor }}>{t("chat:apiRequest.rateLimitWait")}</span>
			</div>
			<span className="text-xs font-light text-vscode-descriptionForeground">{waitSeconds}s</span>
		</div>
	) : null
}
