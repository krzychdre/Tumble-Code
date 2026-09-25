import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { LRUCache } from "lru-cache"
import { Trans } from "react-i18next"

import { getCostBreakdownIfNeeded } from "@src/utils/costFormatting"
import { useDebounceEffect } from "@src/utils/useDebounceEffect"

import type { ClineMessage } from "@roo-code/types"

import { combineApiRequests } from "@roo/combineApiRequests"
import { combineCommandSequences } from "@roo/combineCommandSequences"
import { getApiMetrics } from "@roo/getApiMetrics"
import { ProfileValidator } from "@roo/ProfileValidator"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"
import RooHero from "@src/components/welcome/RooHero"
import RooTips from "@src/components/welcome/RooTips"
import { StandardTooltip, Button } from "@src/components/ui"
import { CloudUpsellDialog } from "@src/components/cloud/CloudUpsellDialog"

import TelemetryBanner from "../common/TelemetryBanner"
import StorageErrorBanner from "../common/StorageErrorBanner"
import VersionIndicator from "../common/VersionIndicator"
import HistoryPreview from "../history/HistoryPreview"
import Announcement from "./Announcement"
import ChatRow from "./ChatRow"
import WarningRow from "./WarningRow"
import { ChatTextArea } from "./ChatTextArea"
import TaskHeader from "./TaskHeader"
import ProfileViolationWarning from "./ProfileViolationWarning"
import { CheckpointWarning } from "./CheckpointWarning"
import { QueuedMessages } from "./QueuedMessages"
import { WorktreeSelector } from "./WorktreeSelector"
import FileChangesPanel from "./FileChangesPanel"
import SubagentsPanel from "./SubagentsPanel"
import MemoryActivityBadge from "./MemoryActivityBadge"
import DismissibleUpsell from "../common/DismissibleUpsell"
import { useCloudUpsell } from "@src/hooks/useCloudUpsell"
import { useScrollLifecycle } from "@src/hooks/useScrollLifecycle"
import { useStableCallback } from "@src/hooks/useStableCallback"
import { EVER_VISIBLE_VIEWPORT, filterVisible, markEverVisible } from "./rows/filterVisible"
import { groupToolAsks } from "./rows/groupToolAsks"
import { computeRowMeta } from "./rows/computeRowMeta"
import { withCondensingRow } from "./rows/condensingRow"
import { selectLatestTodos } from "./latestTodos"
import { useChatSounds } from "./hooks/useChatSounds"
import { useAskButtons } from "./hooks/useAskButtons"
import { useChatComposer } from "./hooks/useChatComposer"
import { MAX_IMAGES_PER_MESSAGE, useChatHostMessages } from "./hooks/useChatHostMessages"
import { useCheckpointNavigation } from "./hooks/useCheckpointNavigation"
import { useModeSwitchShortcuts } from "./hooks/useModeSwitchShortcuts"
import { Cloud } from "lucide-react"

export { MAX_IMAGES_PER_MESSAGE }

export interface ChatViewProps {
	isHidden: boolean
	showAnnouncement: boolean
	hideAnnouncement: () => void
}

export interface ChatViewRef {
	acceptInput: () => void
}

const CHAT_DEFAULT_ITEM_HEIGHT = 180
const CHAT_VIEWPORT_BUFFER = {
	top: 600,
	bottom: 800,
} as const

const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0

const ChatViewComponent: React.ForwardRefRenderFunction<ChatViewRef, ChatViewProps> = (
	{ isHidden, showAnnouncement, hideAnnouncement },
	ref,
) => {
	const { t } = useAppTranslation()
	const modeShortcutText = `${isMac ? "⌘" : "Ctrl"} + . ${t("chat:forNextMode")}, ${isMac ? "⌘" : "Ctrl"} + Shift + . ${t("chat:forPreviousMode")}`

	const {
		clineMessages: messages,
		currentTaskItem,
		currentTaskTodos,
		taskHistory,
		apiConfiguration,
		organizationAllowList,
		mode,
		setMode,
		alwaysAllowModeSwitch,
		customModes,
		telemetrySetting,
		soundEnabled,
		soundVolume,
		customSoundUris,
		cloudIsAuthenticated,
		messageQueue = [],
		showWorktreesInHomeScreen,
		subagents,
		memoryActivity,
		clearSubagents,
	} = useExtensionState()

	const playSound = useChatSounds({ soundEnabled, soundVolume, customSoundUris })

	// Leaving this less safe version here since if the first message is not a
	// task, then the extension is in a bad state and needs to be debugged (see
	// Cline.abort).
	const task = useMemo(() => messages.at(0), [messages])
	const taskTs = task?.ts

	const latestTodos = useMemo(() => selectLatestTodos(messages, currentTaskTodos), [messages, currentTaskTodos])

	const modifiedMessages = useMemo(() => combineApiRequests(combineCommandSequences(messages.slice(1))), [messages])

	// Has to be after api_req_finished are all reduced into api_req_started messages.
	const apiMetrics = useMemo(() => getApiMetrics(modifiedMessages), [modifiedMessages])

	// ts of rows the list has shown ("ever visible"): such a row stays visible
	// even when its kind would now be filtered (see filterVisible). One cache
	// for the component's lifetime; it is mutated only in the effects below,
	// and visibleMessages reads it again only when modifiedMessages changes.
	const [everVisibleMessagesTs] = useState(
		() =>
			new LRUCache<number, boolean>({
				max: 100,
				ttl: 1000 * 60 * 5,
			}),
	)

	const visibleMessages = useMemo(
		() => filterVisible(modifiedMessages, everVisibleMessagesTs),
		[modifiedMessages, everVisibleMessagesTs],
	)

	// Remember the rows just shown. This used to happen inside the useMemo
	// above; as an effect it runs after the render instead. It is declared
	// before the effects that clear the set (task change, hidden view), so when
	// both run in one commit the clear still comes last, as it did before.
	useEffect(() => {
		markEverVisible(visibleMessages, everVisibleMessagesTs)
	}, [visibleMessages, everVisibleMessagesTs])

	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})
	const prevExpandedRowsRef = useRef<Record<number, boolean>>()
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const [showAnnouncementModal, setShowAnnouncementModal] = useState(false)

	const {
		isOpen: isUpsellOpen,
		openUpsell,
		closeUpsell,
		handleConnect,
	} = useCloudUpsell({
		autoOpenOnAuth: false,
	})

	const isProfileDisabled = useMemo(
		() => !!apiConfiguration && !ProfileValidator.isProfileAllowed(apiConfiguration, organizationAllowList),
		[apiConfiguration, organizationAllowList],
	)

	const ask = useAskButtons({
		messages,
		modifiedMessages,
		currentTaskItem,
		messageQueueLength: messageQueue.length,
		playSound,
		t,
	})
	const { clineAsk, enableButtons, primaryButtonText, secondaryButtonText, sendingDisabled, isStreaming } = ask

	const switchToMode = useCallback(
		(modeSlug: string): void => {
			// Update local state and notify extension to sync mode change.
			setMode(modeSlug)

			// Send the mode switch message.
			vscode.postMessage({ type: "mode", text: modeSlug })
		},
		[setMode],
	)

	const composer = useChatComposer({
		ask,
		messages,
		taskTs,
		apiProvider: apiConfiguration?.apiProvider,
		parentTaskId: currentTaskItem?.parentTaskId,
		messageQueueLength: messageQueue.length,
		isProfileDisabled,
		alwaysAllowModeSwitch,
		clearSubagents,
		switchToMode,
	})
	const {
		inputValue,
		setInputValue,
		selectedImages,
		setSelectedImages,
		currentFollowUpTs,
		isFollowUpAutoApprovalPaused,
		showRetiredProviderWarning,
		handleSendMessage,
		handlePrimaryButtonClick,
		handleSecondaryButtonClick,
		handleStopTask,
		handleEnqueueCurrentMessage,
		handleSuggestionClick,
		acceptInput,
	} = composer

	// Reset UI states when task changes. Scroll lifecycle is handled by
	// useScrollLifecycle which has its own effect keyed on taskTs.
	useEffect(() => {
		setExpandedRows({})
		everVisibleMessagesTs.clear()
	}, [taskTs, everVisibleMessagesTs])

	useEffect(() => {
		if (isHidden) {
			everVisibleMessagesTs.clear()
		}
	}, [isHidden, everVisibleMessagesTs])

	useEffect(() => {
		return () => {
			everVisibleMessagesTs.clear()
		}
	}, [everVisibleMessagesTs])

	const { info: model } = useSelectedModel(apiConfiguration)

	const selectImages = useCallback(() => vscode.postMessage({ type: "selectImages" }), [])

	const supportsImages = !!model?.supportsImages
	const shouldDisableImages = !supportsImages || selectedImages.length >= MAX_IMAGES_PER_MESSAGE

	const { isCondensing, checkpointWarning, aggregatedCostsMap, handleCondenseContext } = useChatHostMessages({
		ask,
		composer,
		isHidden,
		textAreaRef,
		playSound,
		task,
		currentTaskItem,
		modifiedMessagesLength: modifiedMessages.length,
	})

	useEffect(() => {
		const cleanupInterval = setInterval(() => {
			const currentMessageIds = new Set(modifiedMessages.map((m: ClineMessage) => m.ts))
			const viewportMessages = visibleMessages.slice(Math.max(0, visibleMessages.length - EVER_VISIBLE_VIEWPORT))
			const viewportMessageIds = new Set(viewportMessages.map((m: ClineMessage) => m.ts))

			everVisibleMessagesTs.forEach((_value: boolean, key: number) => {
				if (!currentMessageIds.has(key) && !viewportMessageIds.has(key)) {
					everVisibleMessagesTs.delete(key)
				}
			})
		}, 60000)

		return () => clearInterval(cleanupInterval)
	}, [modifiedMessages, visibleMessages, everVisibleMessagesTs])

	useDebounceEffect(
		() => {
			if (!isHidden && !sendingDisabled && !enableButtons) {
				textAreaRef.current?.focus()
			}
		},
		50,
		[isHidden, sendingDisabled, enableButtons],
	)

	const toolGroupedMessages = useMemo(() => groupToolAsks(visibleMessages), [visibleMessages])

	const groupedMessages = useMemo(
		() => withCondensingRow(toolGroupedMessages, isCondensing),
		[toolGroupedMessages, isCondensing],
	)

	// byTs goes to the rows, so ChatRow never scans clineMessages itself.
	const { checkpointIndices, byTs: rowMetaByTs } = useMemo(
		() => computeRowMeta(messages, groupedMessages),
		[messages, groupedMessages],
	)

	// Scroll lifecycle is managed by a dedicated hook to keep ChatView focused
	// on message handling and UI orchestration.
	const {
		showScrollToBottom,
		handleRowHeightChange,
		handleScrollToBottomClick,
		enterUserBrowsingHistory,
		followOutputCallback,
		atBottomStateChangeCallback,
		scrollToBottomAuto,
		isAtBottomRef,
		scrollPhaseRef,
	} = useScrollLifecycle({
		virtuosoRef,
		scrollContainerRef,
		taskTs: task?.ts,
		isStreaming,
		isHidden,
		hasTask: !!task,
	})

	const { hasLatestCheckpoint, handleScrollToBottomAndResetCheckpointCursor, handleScrollToLatestCheckpoint } =
		useCheckpointNavigation({
			checkpointIndices,
			taskTs,
			virtuosoRef,
			enterUserBrowsingHistory,
			handleScrollToBottomClick,
		})

	// Expanding a row indicates the user is browsing; disable sticky follow.
	// Placed after the hook call so enterUserBrowsingHistory is defined.
	useEffect(() => {
		const prev = prevExpandedRowsRef.current
		let wasAnyRowExpandedByUser = false
		if (prev) {
			for (const [tsKey, isExpanded] of Object.entries(expandedRows)) {
				const ts = Number(tsKey)
				if (isExpanded && !(prev[ts] ?? false)) {
					wasAnyRowExpandedByUser = true
					break
				}
			}
		}

		if (wasAnyRowExpandedByUser) {
			enterUserBrowsingHistory("row-expansion")
		}

		prevExpandedRowsRef.current = expandedRows
	}, [enterUserBrowsingHistory, expandedRows])

	// Rows toggle their expansion through this. The row passes the target
	// state explicitly, because some rows open by default and therefore have
	// no entry in expandedRows to flip. The effect above turns an expansion
	// into "the user is browsing".
	const toggleRowExpansion = useCallback((ts: number, expand?: boolean) => {
		setExpandedRows((prev: Record<number, boolean>) => ({
			...prev,
			[ts]: expand === undefined ? !prev[ts] : expand,
		}))
	}, [])

	const placeholderText = task ? t("chat:typeMessage") : t("chat:typeTask")

	const handleBatchFileResponse = useCallback((response: { [key: string]: boolean }) => {
		// Handle batch file response, e.g., for file uploads
		vscode.postMessage({ type: "askResponse", askResponse: "objectResponse", text: JSON.stringify(response) })
	}, [])

	// Cancel backend auto-approval timeout when FollowUpSuggest's countdown effect cleans up.
	// This is called when auto-approve is toggled off, a suggestion is clicked, or the component unmounts.
	const handleFollowUpUnmount = useCallback(() => {
		vscode.postMessage({ type: "cancelAutoApproval" })
	}, [])

	// True exactly while the Run Command / Reject buttons are on screen for a
	// command ask, which is the only moment the user has to read the command
	// before deciding. An auto-approved ask arrives already stamped isAnswered,
	// and the last-message effect bails out before touching clineAsk or
	// enableButtons, so this never flips on and straight back off.
	const isCommandAwaitingApproval = clineAsk === "command" && enableButtons

	// Both handlers get a new identity whenever a message streams in (the
	// suggestion handler through handleSendMessage, the checkpoint jump
	// through checkpointIndices). Rows get stable wrappers so ChatRow's memo
	// can skip every row but the streamed one.
	const onRowSuggestionClick = useStableCallback(handleSuggestionClick)
	const onRowJumpToPreviousCheckpoint = useStableCallback(handleScrollToLatestCheckpoint)

	const itemContent = useCallback(
		(index: number, messageOrGroup: ClineMessage) => {
			const isLast = index === groupedMessages.length - 1

			// regular message
			return (
				<ChatRow
					key={messageOrGroup.ts}
					message={messageOrGroup}
					// `??` and not `||`: an explicit false (the user collapsed the
					// row) must win over the default-open below.
					isExpanded={
						expandedRows[messageOrGroup.ts] ??
						(isLast &&
							messageOrGroup.type === "ask" &&
							messageOrGroup.ask === "command" &&
							isCommandAwaitingApproval)
					}
					onToggleExpand={toggleRowExpansion} // This was already stabilized
					// Only the last row reads it, and it changes on every streamed
					// token: passing it to every row would defeat ChatRow's memo.
					lastModifiedMessage={isLast ? modifiedMessages.at(-1) : undefined}
					isLast={isLast}
					onHeightChange={handleRowHeightChange}
					isStreaming={isStreaming}
					supportsImages={supportsImages}
					onSuggestionClick={onRowSuggestionClick}
					onBatchFileResponse={handleBatchFileResponse}
					onFollowUpUnmount={handleFollowUpUnmount}
					isFollowUpAnswered={messageOrGroup.isAnswered === true || messageOrGroup.ts === currentFollowUpTs}
					isFollowUpAutoApprovalPaused={isFollowUpAutoApprovalPaused}
					onJumpToPreviousCheckpoint={onRowJumpToPreviousCheckpoint}
					// A new entry object per history change, but equal for rows
					// whose surroundings did not change, so the memo still holds.
					meta={rowMetaByTs.get(messageOrGroup.ts)}
				/>
			)
		},
		[
			expandedRows,
			toggleRowExpansion,
			modifiedMessages,
			groupedMessages.length,
			handleRowHeightChange,
			isStreaming,
			supportsImages,
			onRowSuggestionClick,
			handleBatchFileResponse,
			handleFollowUpUnmount,
			currentFollowUpTs,
			isFollowUpAutoApprovalPaused,
			isCommandAwaitingApproval,
			onRowJumpToPreviousCheckpoint,
			rowMetaByTs,
		],
	)

	const computeMessageKey = useCallback(
		(index: number, messageOrGroup: ClineMessage) => `${messageOrGroup.ts}-${index}`,
		[],
	)

	useModeSwitchShortcuts(mode, customModes, switchToMode)

	useImperativeHandle(ref, () => ({ acceptInput }))

	const areButtonsVisible = showScrollToBottom || primaryButtonText || secondaryButtonText

	return (
		<div
			data-testid="chat-view"
			className={isHidden ? "hidden" : "fixed top-0 left-0 right-0 bottom-0 flex flex-col overflow-hidden"}>
			<StorageErrorBanner />
			{telemetrySetting === "unset" && <TelemetryBanner />}
			{(showAnnouncement || showAnnouncementModal) && (
				<Announcement
					hideAnnouncement={() => {
						if (showAnnouncementModal) {
							setShowAnnouncementModal(false)
						}
						if (showAnnouncement) {
							hideAnnouncement()
						}
					}}
				/>
			)}
			{task ? (
				<>
					<TaskHeader
						task={task}
						tokensIn={apiMetrics.totalTokensIn}
						tokensOut={apiMetrics.totalTokensOut}
						cacheWrites={apiMetrics.totalCacheWrites}
						cacheReads={apiMetrics.totalCacheReads}
						totalCost={apiMetrics.totalCost}
						aggregatedCost={
							currentTaskItem?.id && aggregatedCostsMap.has(currentTaskItem.id)
								? aggregatedCostsMap.get(currentTaskItem.id)!.totalCost
								: undefined
						}
						hasSubtasks={
							!!(
								currentTaskItem?.id &&
								aggregatedCostsMap.has(currentTaskItem.id) &&
								aggregatedCostsMap.get(currentTaskItem.id)!.childrenCost > 0
							)
						}
						parentTaskId={currentTaskItem?.parentTaskId}
						costBreakdown={
							currentTaskItem?.id && aggregatedCostsMap.has(currentTaskItem.id)
								? getCostBreakdownIfNeeded(aggregatedCostsMap.get(currentTaskItem.id)!, {
										own: t("common:costs.own"),
										subtasks: t("common:costs.subtasks"),
									})
								: undefined
						}
						contextTokens={apiMetrics.contextTokens}
						buttonsDisabled={sendingDisabled}
						handleCondenseContext={handleCondenseContext}
						todos={latestTodos}
					/>

					{checkpointWarning && (
						<div className="px-3">
							<CheckpointWarning warning={checkpointWarning} />
						</div>
					)}
				</>
			) : (
				<div className="flex flex-col h-full p-6 min-h-0 overflow-y-auto gap-4 relative">
					<div className="flex flex-col items-start gap-2 my-auto min-[400px]:px-6">
						<VersionIndicator
							onClick={() => setShowAnnouncementModal(true)}
							className="absolute top-2 right-3 z-10"
						/>
						<div className="flex flex-col gap-4 w-full">
							<RooHero />
							{/* Show RooTips when authenticated or when user is new */}
							{taskHistory.length < 6 && <RooTips />}
							{/* Everyone should see their task history if any */}
							{taskHistory.length > 0 && <HistoryPreview />}
						</div>
						{/* Logged out users should see a one-time upsell, but not for brand new users */}
						{!cloudIsAuthenticated && taskHistory.length >= 6 && (
							<DismissibleUpsell
								upsellId="taskList2"
								icon={<Cloud className="size-5 shrink-0" />}
								onClick={() => openUpsell()}
								dismissOnClick={false}
								className="bg-none mt-6 border-border rounded-xl p-3 !text-base">
								<Trans
									i18nKey="cloud:upsell.taskList"
									components={{
										learnMoreLink: <VSCodeLink href="#" />,
									}}
								/>
							</DismissibleUpsell>
						)}
					</div>
				</div>
			)}

			{!task && showWorktreesInHomeScreen && <WorktreeSelector />}

			{task && (
				<>
					<div className="grow flex" ref={scrollContainerRef}>
						<Virtuoso
							ref={virtuosoRef}
							key={task.ts}
							className="scrollable grow overflow-y-scroll mb-1"
							computeItemKey={computeMessageKey}
							defaultItemHeight={CHAT_DEFAULT_ITEM_HEIGHT}
							increaseViewportBy={CHAT_VIEWPORT_BUFFER}
							data={groupedMessages}
							itemContent={itemContent}
							followOutput={followOutputCallback}
							atBottomStateChange={atBottomStateChangeCallback}
							atBottomThreshold={10}
						/>
					</div>
					<MemoryActivityBadge memoryActivity={memoryActivity} />
					<SubagentsPanel subagents={subagents} />
					<FileChangesPanel clineMessages={messages} />
					{areButtonsVisible && (
						<div
							className={`flex h-9 items-center mb-1 px-[15px] ${
								showScrollToBottom ? "opacity-100" : enableButtons ? "opacity-100" : "opacity-50"
							}`}>
							{showScrollToBottom ? (
								<>
									<StandardTooltip content={t("chat:scrollToBottom")}>
										<Button
											variant="secondary"
											className={hasLatestCheckpoint ? "flex-1 mr-[6px]" : "flex-[2]"}
											onClick={handleScrollToBottomAndResetCheckpointCursor}>
											<span className="codicon codicon-chevron-down"></span>
										</Button>
									</StandardTooltip>
									{hasLatestCheckpoint && (
										<StandardTooltip content={t("chat:scrollToLatestCheckpoint")}>
											<Button
												variant="secondary"
												className="flex-1 ml-[6px]"
												onClick={handleScrollToLatestCheckpoint}
												aria-label={t("chat:scrollToLatestCheckpoint")}>
												<span className="codicon codicon-history"></span>
											</Button>
										</StandardTooltip>
									)}
								</>
							) : (
								<>
									{primaryButtonText && (
										<StandardTooltip
											content={
												primaryButtonText === t("chat:retry.title")
													? t("chat:retry.tooltip")
													: primaryButtonText === t("chat:save.title")
														? t("chat:save.tooltip")
														: primaryButtonText === t("chat:approve.title")
															? t("chat:approve.tooltip")
															: primaryButtonText === t("chat:runCommand.title")
																? t("chat:runCommand.tooltip")
																: primaryButtonText === t("chat:startNewTask.title")
																	? t("chat:startNewTask.tooltip")
																	: primaryButtonText === t("chat:resumeTask.title")
																		? t("chat:resumeTask.tooltip")
																		: primaryButtonText ===
																			  t("chat:proceedAnyways.title")
																			? t("chat:proceedAnyways.tooltip")
																			: primaryButtonText ===
																				  t("chat:proceedWhileRunning.title")
																				? t("chat:proceedWhileRunning.tooltip")
																				: undefined
											}>
											<Button
												variant="primary"
												disabled={!enableButtons}
												className={secondaryButtonText ? "flex-1 mr-[6px]" : "flex-[2] mr-0"}
												onClick={() => handlePrimaryButtonClick(inputValue, selectedImages)}>
												{primaryButtonText}
											</Button>
										</StandardTooltip>
									)}
									{secondaryButtonText && (
										<StandardTooltip
											content={
												secondaryButtonText === t("chat:startNewTask.title")
													? t("chat:startNewTask.tooltip")
													: secondaryButtonText === t("chat:reject.title")
														? t("chat:reject.tooltip")
														: secondaryButtonText === t("chat:terminate.title")
															? t("chat:terminate.tooltip")
															: secondaryButtonText === t("chat:killCommand.title")
																? t("chat:killCommand.tooltip")
																: undefined
											}>
											<Button
												variant="secondary"
												disabled={!enableButtons}
												className="flex-1 ml-[6px]"
												onClick={() => handleSecondaryButtonClick(inputValue, selectedImages)}>
												{secondaryButtonText}
											</Button>
										</StandardTooltip>
									)}
								</>
							)}
						</div>
					)}
				</>
			)}

			<QueuedMessages
				queue={messageQueue}
				onRemove={(index) => {
					if (messageQueue[index]) {
						vscode.postMessage({ type: "removeQueuedMessage", text: messageQueue[index].id })
					}
				}}
				onUpdate={(index, newText) => {
					if (messageQueue[index]) {
						vscode.postMessage({
							type: "editQueuedMessage",
							payload: { id: messageQueue[index].id, text: newText, images: messageQueue[index].images },
						})
					}
				}}
			/>
			{showRetiredProviderWarning && (
				<div className="px-[15px] py-1">
					<WarningRow
						title={t("chat:retiredProvider.title")}
						message={t("chat:retiredProvider.message")}
						actionText={t("chat:retiredProvider.openSettings")}
						onAction={() => vscode.postMessage({ type: "switchTab", tab: "settings" })}
					/>
				</div>
			)}
			<ChatTextArea
				ref={textAreaRef}
				inputValue={inputValue}
				setInputValue={setInputValue}
				sendingDisabled={sendingDisabled || isProfileDisabled}
				selectApiConfigDisabled={sendingDisabled && clineAsk !== "api_req_failed"}
				placeholderText={placeholderText}
				selectedImages={selectedImages}
				setSelectedImages={setSelectedImages}
				onSend={() => handleSendMessage(inputValue, selectedImages)}
				onSelectImages={selectImages}
				shouldDisableImages={shouldDisableImages}
				onHeightChange={() => {
					if (isAtBottomRef.current && scrollPhaseRef.current !== "USER_BROWSING_HISTORY") {
						scrollToBottomAuto()
					}
				}}
				mode={mode}
				setMode={setMode}
				modeShortcutText={modeShortcutText}
				isStreaming={isStreaming}
				onStop={handleStopTask}
				onEnqueueMessage={handleEnqueueCurrentMessage}
			/>

			{isProfileDisabled && (
				<div className="px-3">
					<ProfileViolationWarning />
				</div>
			)}

			<div id="roo-portal" />
			<CloudUpsellDialog open={isUpsellOpen} onOpenChange={closeUpsell} onConnect={handleConnect} />
		</div>
	)
}

const ChatView = forwardRef(ChatViewComponent)

export default ChatView
