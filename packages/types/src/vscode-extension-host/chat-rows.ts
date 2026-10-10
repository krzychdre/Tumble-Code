/*
 * Payloads the host stores in chat messages (`ClineMessage.text` as JSON)
 * for the webview and the CLI to render: tool rows, MCP asks and API
 * request rows. They travel inside `messageUpdated`, `messageAdded` and
 * `state`, not as channel messages of their own.
 */

export interface ClineSayTool {
	tool:
		| "editedExistingFile"
		| "appliedDiff"
		| "newFileCreated"
		| "codebaseSearch"
		| "readFile"
		| "readArtifact"
		// Emitted by builds before `read_artifact` existed; kept so old task
		// histories still render.
		| "readCommandOutput"
		| "listFilesTopLevel"
		| "listFilesRecursive"
		| "searchFiles"
		| "searchTaskHistory"
		| "switchMode"
		| "newTask"
		| "finishTask"
		| "reviewPlan"
		// Emitted by the removed run_slash_command tool; kept so old task
		// histories still render.
		| "runSlashCommand"
		| "updateTodoList"
		| "skill"
		| "webSearch"
		| "webFetch"
	path?: string
	// For readArtifact (and the legacy readCommandOutput)
	readStart?: number
	readEnd?: number
	totalBytes?: number
	searchPattern?: string
	matchCount?: number
	diff?: string
	content?: string
	// Original file content before first edit (for merged diff display in FileChangesPanel)
	originalContent?: string
	// Unified diff statistics computed by the extension
	diffStats?: { added: number; removed: number }
	regex?: string
	filePattern?: string
	mode?: string
	reason?: string
	isOutsideWorkspace?: boolean
	isProtected?: boolean
	additionalFileCount?: number // Number of additional files in the same read_file request
	lineNumber?: number
	startLine?: number // Starting line for read_file operations (for navigation on click)
	query?: string
	batchFiles?: Array<{
		path: string
		lineSnippet: string
		isOutsideWorkspace?: boolean
		key: string
		content?: string
	}>
	batchDiffs?: Array<{
		path: string
		changeCount: number
		key: string
		content: string
		// Per-file unified diff statistics computed by the extension
		diffStats?: { added: number; removed: number }
		diffs?: Array<{
			content: string
			startLine?: number
		}>
	}>
	batchDirs?: Array<{
		path: string
		recursive: boolean
		isOutsideWorkspace?: boolean
		key: string
	}>
	question?: string
	// Properties for the legacy runSlashCommand rows
	command?: string
	args?: string
	source?: string
	description?: string
	// Properties for skill tool
	skill?: string
	// Properties for the web tools: the queries web_search ran, and the URL
	// web_fetch read (after redirects).
	queries?: string[]
	fetchedUrl?: string
	// Native tool-call id, stamped by tools whose handlePartial placeholder and
	// complete payload diverge in text (read_file, search_files). Lets the
	// finalized-duplicate dedup recognise the placeholder and the complete card
	// as the same invocation without a brittle text comparison.
	toolCallId?: string
}

export interface ClineAskUseMcpServer {
	serverName: string
	type: "use_mcp_tool" | "access_mcp_resource"
	toolName?: string
	arguments?: string
	uri?: string
	response?: string
}

export interface ClineApiReqInfo {
	request?: string
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	cost?: number
	cancelReason?: ClineApiReqCancelReason
	streamingFailedMessage?: string
	apiProtocol?: "anthropic" | "openai"
}

export type ClineApiReqCancelReason = "streaming_failed" | "user_cancelled" | "max_turns_reached"
