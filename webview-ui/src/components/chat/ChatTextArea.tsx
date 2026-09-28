import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import DynamicTextArea from "react-textarea-autosize"

import type { ExtensionMessage } from "@roo-code/types"

import { Mode, getAllModes } from "@roo/modes"

import { vscode } from "@src/utils/vscode"
import { useExtensionSelector } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"
import { convertToMentionPath } from "@src/utils/path-mentions"

import Thumbnails from "../common/Thumbnails"
import { MAX_IMAGES_PER_MESSAGE } from "./ChatView"
import ContextMenu from "./ContextMenu"
import { ComposerActionButtons } from "./ComposerActionButtons"
import { ComposerToolbar } from "./ComposerToolbar"
import { useHighlightLayer } from "./hooks/useHighlightLayer"
import { useMentionMenu } from "./hooks/useMentionMenu"
import { usePromptHistory } from "./hooks/usePromptHistory"
import { onExtensionMessage } from "@src/utils/extensionBus"

interface ChatTextAreaProps {
	inputValue: string
	setInputValue: (value: string) => void
	sendingDisabled: boolean
	selectApiConfigDisabled: boolean
	placeholderText: string
	selectedImages: string[]
	setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
	onSend: () => void
	onSelectImages: () => void
	shouldDisableImages: boolean
	onHeightChange?: (height: number) => void
	mode: Mode
	setMode: (value: Mode) => void
	modeShortcutText: string
	// Edit mode props
	isEditMode?: boolean
	onCancel?: () => void
	// Stop/Queue functionality
	isStreaming?: boolean
	onStop?: () => void
	onEnqueueMessage?: () => void
}

export const ChatTextArea = forwardRef<HTMLTextAreaElement, ChatTextAreaProps>(
	(
		{
			inputValue,
			setInputValue,
			selectApiConfigDisabled,
			placeholderText,
			selectedImages,
			setSelectedImages,
			onSend,
			onSelectImages,
			shouldDisableImages,
			onHeightChange,
			mode,
			setMode,
			modeShortcutText,
			isEditMode = false,
			onCancel,
			isStreaming = false,
			onStop,
			onEnqueueMessage,
		},
		ref,
	) => {
		const { t } = useAppTranslation()
		// P1: narrow selectors. The composer used to consume the whole extension state and re-render on
		// every streamed token. The selector row (ComposerToolbar) and the mention menu (useMentionMenu)
		// select their own slices.
		const customModes = useExtensionSelector((s) => s.customModes)
		const cwd = useExtensionSelector((s) => s.cwd)
		const taskHistory = useExtensionSelector((s) => s.taskHistory)
		const clineMessages = useExtensionSelector((s) => s.clineMessages)
		const commands = useExtensionSelector((s) => s.commands)
		const enterBehavior = useExtensionSelector((s) => s.enterBehavior)

		// Declared before the message handler below, which uses it: the React Compiler skips a component
		// that reads a value above its declaration.
		const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
		const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false)

		// Handle enhanced prompt response and text inserted by the extension.
		useEffect(() => {
			const messageHandler = (message: ExtensionMessage) => {
				if (message.type === "enhancedPrompt") {
					if (message.text && textAreaRef.current) {
						try {
							// Use execCommand to replace text while preserving undo history
							if (document.execCommand) {
								// Use native browser methods to preserve undo stack
								const textarea = textAreaRef.current

								// Focus the textarea to ensure it's the active element
								textarea.focus()

								// Select all text first
								textarea.select()
								document.execCommand("insertText", false, message.text)
							} else {
								setInputValue(message.text)
							}
						} catch {
							setInputValue(message.text)
						}
					}

					setIsEnhancingPrompt(false)
				} else if (message.type === "insertTextIntoTextarea") {
					if (message.text && textAreaRef.current) {
						// Insert the command text at the current cursor position
						const textarea = textAreaRef.current
						const currentValue = inputValue
						const cursorPos = textarea.selectionStart || 0

						// Check if we need to add a space before the command
						const textBefore = currentValue.slice(0, cursorPos)
						const needsSpaceBefore = textBefore.length > 0 && !textBefore.endsWith(" ")
						const prefix = needsSpaceBefore ? " " : ""

						// Insert the text at cursor position
						const newValue =
							currentValue.slice(0, cursorPos) +
							prefix +
							message.text +
							" " +
							currentValue.slice(cursorPos)
						setInputValue(newValue)

						// Set cursor position after the inserted text
						const newCursorPos = cursorPos + prefix.length + message.text.length + 1
						setTimeout(() => {
							if (textAreaRef.current) {
								textAreaRef.current.focus()
								textAreaRef.current.setSelectionRange(newCursorPos, newCursorPos)
							}
						}, 0)
					}
				}
			}

			return onExtensionMessage(["enhancedPrompt", "insertTextIntoTextarea"], messageHandler)
		}, [setInputValue, inputValue])

		const [isDraggingOver, setIsDraggingOver] = useState(false)
		const [textAreaBaseHeight, setTextAreaBaseHeight] = useState<number | undefined>(undefined)
		const [cursorPosition, setCursorPosition] = useState(0)
		const [intendedCursorPosition, setIntendedCursorPosition] = useState<number | null>(null)
		const [isFocused, setIsFocused] = useState(false)

		// Use custom hook for prompt history navigation
		const { handleHistoryNavigation, resetHistoryNavigation, resetOnInputChange } = usePromptHistory({
			clineMessages,
			taskHistory,
			cwd,
			inputValue,
			setInputValue,
		})

		const handleEnhancePrompt = useCallback(() => {
			const trimmedInput = inputValue.trim()

			if (trimmedInput) {
				setIsEnhancingPrompt(true)
				vscode.postMessage({ type: "enhancePrompt" as const, text: trimmedInput })
			} else {
				setInputValue(t("chat:enhancePromptDescription"))
			}
		}, [inputValue, setInputValue, t])

		const allModes = useMemo(() => getAllModes(customModes), [customModes])

		// Memoized check for whether the input has content (text or images)
		const hasInputContent = useMemo(() => {
			return inputValue.trim().length > 0 || selectedImages.length > 0
		}, [inputValue, selectedImages])

		const {
			showContextMenu,
			contextMenuContainerRef,
			menuProps,
			handleMenuKeyDown,
			handleMentionBackspace,
			updateMenuForInput,
			handleMenuBlur,
			closeMenu,
		} = useMentionMenu({
			textAreaRef,
			inputValue,
			setInputValue,
			setMode,
			cursorPosition,
			setCursorPosition,
			setIntendedCursorPosition,
			allModes,
			commands,
		})

		const handleKeyDown = useCallback(
			(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
				if (handleMenuKeyDown(event)) {
					return
				}

				const isComposing = event.nativeEvent?.isComposing ?? false

				// Handle prompt history navigation using custom hook
				if (handleHistoryNavigation(event, showContextMenu, isComposing)) {
					return
				}

				// Handle Enter key based on enterBehavior setting
				if (event.key === "Enter" && !isComposing) {
					if (enterBehavior === "newline") {
						// New behavior: Enter = newline, Ctrl/Cmd+Enter = send
						if (event.ctrlKey || event.metaKey) {
							event.preventDefault()
							resetHistoryNavigation()
							onSend()
						}
						// Otherwise, let Enter create newline (don't preventDefault)
					} else {
						// Default behavior: Enter = send, Shift+Enter = newline
						if (!event.shiftKey) {
							event.preventDefault()
							resetHistoryNavigation()
							onSend()
						}
					}
				}

				if (event.key === "Backspace" && !isComposing) {
					handleMentionBackspace(event)
				}
			},
			[
				onSend,
				showContextMenu,
				handleMenuKeyDown,
				handleMentionBackspace,
				handleHistoryNavigation,
				resetHistoryNavigation,
				enterBehavior,
			],
		)

		useLayoutEffect(() => {
			if (intendedCursorPosition !== null && textAreaRef.current) {
				textAreaRef.current.setSelectionRange(intendedCursorPosition, intendedCursorPosition)
				setIntendedCursorPosition(null) // Reset the state.
			}
		}, [inputValue, intendedCursorPosition])

		const { highlightLayerRef, updateHighlights } = useHighlightLayer(textAreaRef, inputValue, commands)

		const handleInputChange = useCallback(
			(e: React.ChangeEvent<HTMLTextAreaElement>) => {
				const newValue = e.target.value
				setInputValue(newValue)

				// Reset history navigation when user types
				resetOnInputChange()

				const newCursorPosition = e.target.selectionStart
				setCursorPosition(newCursorPosition)

				updateMenuForInput(newValue, newCursorPosition)
			},
			[setInputValue, resetOnInputChange, updateMenuForInput],
		)

		const handleBlur = useCallback(() => {
			// Only hide the context menu if the user didn't click on it.
			handleMenuBlur()

			setIsFocused(false)
		}, [handleMenuBlur])

		const handlePaste = useCallback(
			async (e: React.ClipboardEvent) => {
				const items = e.clipboardData.items

				const pastedText = e.clipboardData.getData("text")
				// Check if the pasted content is a URL, add space after so user
				// can easily delete if they don't want it.
				const urlRegex = /^\S+:\/\/\S+$/
				if (urlRegex.test(pastedText.trim())) {
					e.preventDefault()
					const trimmedUrl = pastedText.trim()
					const newValue =
						inputValue.slice(0, cursorPosition) + trimmedUrl + " " + inputValue.slice(cursorPosition)
					setInputValue(newValue)
					const newCursorPosition = cursorPosition + trimmedUrl.length + 1
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)
					closeMenu()

					// Scroll to new cursor position.
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)

					return
				}

				const acceptedTypes = ["png", "jpeg", "webp"]

				const imageItems = Array.from(items).filter((item) => {
					const [type, subtype] = item.type.split("/")
					return type === "image" && acceptedTypes.includes(subtype)
				})

				if (!shouldDisableImages && imageItems.length > 0) {
					e.preventDefault()

					const imagePromises = imageItems.map((item) => {
						return new Promise<string | null>((resolve) => {
							const blob = item.getAsFile()

							if (!blob) {
								resolve(null)
								return
							}

							const reader = new FileReader()

							reader.onloadend = () => {
								if (reader.error) {
									console.error(t("chat:errorReadingFile"), reader.error)
									resolve(null)
								} else {
									const result = reader.result
									resolve(typeof result === "string" ? result : null)
								}
							}

							reader.readAsDataURL(blob)
						})
					})

					const imageDataArray = await Promise.all(imagePromises)
					const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)

					if (dataUrls.length > 0) {
						setSelectedImages((prevImages) => [...prevImages, ...dataUrls].slice(0, MAX_IMAGES_PER_MESSAGE))
					} else {
						console.warn(t("chat:noValidImages"))
					}
				}
			},
			[shouldDisableImages, setSelectedImages, cursorPosition, setInputValue, inputValue, t, closeMenu],
		)

		const updateCursorPosition = useCallback(() => {
			if (textAreaRef.current) {
				setCursorPosition(textAreaRef.current.selectionStart)
			}
		}, [])

		const handleKeyUp = useCallback(
			(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
				if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
					updateCursorPosition()
				}
			},
			[updateCursorPosition],
		)

		const handleDrop = useCallback(
			async (e: React.DragEvent<HTMLDivElement>) => {
				e.preventDefault()
				setIsDraggingOver(false)

				const textFieldList = e.dataTransfer.getData("text")
				const textUriList = e.dataTransfer.getData("application/vnd.code.uri-list")
				// When textFieldList is empty, it may attempt to use textUriList obtained from drag-and-drop tabs; if not empty, it will use textFieldList.
				const text = textFieldList || textUriList
				if (text) {
					// Split text on newlines to handle multiple files
					const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "")

					if (lines.length > 0) {
						// Process each line as a separate file path
						let newValue = inputValue.slice(0, cursorPosition)
						let totalLength = 0

						// Using a standard for loop instead of forEach for potential performance gains.
						for (let i = 0; i < lines.length; i++) {
							const line = lines[i]
							// Convert each path to a mention-friendly format
							const mentionText = convertToMentionPath(line, cwd)
							newValue += mentionText
							totalLength += mentionText.length

							// Add space after each mention except the last one
							if (i < lines.length - 1) {
								newValue += " "
								totalLength += 1
							}
						}

						// Add space after the last mention and append the rest of the input
						newValue += " " + inputValue.slice(cursorPosition)
						totalLength += 1

						setInputValue(newValue)
						const newCursorPosition = cursorPosition + totalLength
						setCursorPosition(newCursorPosition)
						setIntendedCursorPosition(newCursorPosition)
					}

					return
				}

				const files = Array.from(e.dataTransfer.files)

				if (files.length > 0) {
					const acceptedTypes = ["png", "jpeg", "webp"]

					const imageFiles = files.filter((file) => {
						const [type, subtype] = file.type.split("/")
						return type === "image" && acceptedTypes.includes(subtype)
					})

					if (!shouldDisableImages && imageFiles.length > 0) {
						const imagePromises = imageFiles.map((file) => {
							return new Promise<string | null>((resolve) => {
								const reader = new FileReader()

								reader.onloadend = () => {
									if (reader.error) {
										console.error(t("chat:errorReadingFile"), reader.error)
										resolve(null)
									} else {
										const result = reader.result
										resolve(typeof result === "string" ? result : null)
									}
								}

								reader.readAsDataURL(file)
							})
						})

						const imageDataArray = await Promise.all(imagePromises)
						const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)

						if (dataUrls.length > 0) {
							setSelectedImages((prevImages) =>
								[...prevImages, ...dataUrls].slice(0, MAX_IMAGES_PER_MESSAGE),
							)
						} else {
							console.warn(t("chat:noValidImages"))
						}
					}
				}
			},
			[
				cursorPosition,
				cwd,
				inputValue,
				setInputValue,
				setCursorPosition,
				setIntendedCursorPosition,
				shouldDisableImages,
				setSelectedImages,
				t,
			],
		)

		const placeholderBottomText = `\n(${t("chat:addContext")}${shouldDisableImages ? `, ${t("chat:dragFiles")}` : `, ${t("chat:dragFilesImages")}`})`

		return (
			<div
				className={cn(
					"flex flex-col gap-1 bg-editor-background outline-none border border-none box-border",
					isEditMode ? "p-2 w-full" : "relative px-1.5 pb-1 w-[calc(100%-16px)] ml-auto mr-auto",
				)}>
				<div className={cn(!isEditMode && "relative")}>
					<div
						className={cn("chat-text-area", !isEditMode && "relative", "flex", "flex-col", "outline-none")}
						onDrop={handleDrop}
						onDragOver={(e) => {
							// Only allowed to drop images/files on shift key pressed.
							if (!e.shiftKey) {
								setIsDraggingOver(false)
								return
							}

							e.preventDefault()
							setIsDraggingOver(true)
							e.dataTransfer.dropEffect = "copy"
						}}
						onDragLeave={(e) => {
							e.preventDefault()
							const rect = e.currentTarget.getBoundingClientRect()

							if (
								e.clientX <= rect.left ||
								e.clientX >= rect.right ||
								e.clientY <= rect.top ||
								e.clientY >= rect.bottom
							) {
								setIsDraggingOver(false)
							}
						}}>
						{showContextMenu && (
							<div
								ref={contextMenuContainerRef}
								className={cn(
									"absolute",
									"bottom-full",
									isEditMode ? "left-6" : "left-0",
									"right-0",
									"z-[1000]",
									isEditMode ? "-mb-3" : "mb-2",
									"filter",
									"drop-shadow-md",
								)}>
								<ContextMenu {...menuProps} />
							</div>
						)}

						<div
							className={cn(
								"relative",
								"flex-1",
								"flex",
								"flex-col-reverse",
								"min-h-0",
								"overflow-hidden",
								"rounded-lg",
							)}>
							<div
								ref={highlightLayerRef}
								data-testid="highlight-layer"
								className={cn(
									"absolute",
									"inset-0",
									"pointer-events-none",
									"whitespace-pre-wrap",
									"break-words",
									"text-transparent",
									"overflow-hidden",
									"font-vscode-font-family",
									"text-vscode-editor-font-size",
									"leading-vscode-editor-line-height",
									isFocused
										? "border border-vscode-focusBorder outline outline-vscode-focusBorder"
										: isDraggingOver
											? "border-2 border-dashed border-vscode-focusBorder"
											: "border border-transparent",
									"pl-2",
									"py-2",
									isEditMode ? "pr-20" : "pr-9",
									"z-10",
									"forced-color-adjust-none",
									"rounded-lg",
								)}
								style={{
									color: "transparent",
								}}
							/>
							<DynamicTextArea
								ref={(el) => {
									if (typeof ref === "function") {
										ref(el)
									} else if (ref) {
										ref.current = el
									}
									textAreaRef.current = el
								}}
								value={inputValue}
								onChange={(e) => {
									handleInputChange(e)
									updateHighlights()
								}}
								onFocus={() => setIsFocused(true)}
								onKeyDown={(e) => {
									// Handle ESC to cancel in edit mode
									if (isEditMode && e.key === "Escape" && !e.nativeEvent?.isComposing) {
										e.preventDefault()
										onCancel?.()
										return
									}
									handleKeyDown(e)
								}}
								onKeyUp={handleKeyUp}
								onBlur={handleBlur}
								onPaste={handlePaste}
								onSelect={updateCursorPosition}
								onMouseUp={updateCursorPosition}
								onHeightChange={(height) => {
									if (textAreaBaseHeight === undefined || height < textAreaBaseHeight) {
										setTextAreaBaseHeight(height)
									}

									onHeightChange?.(height)
								}}
								placeholder={placeholderText}
								minRows={3}
								maxRows={15}
								autoFocus={true}
								className={cn(
									"w-full",
									"text-vscode-input-foreground",
									"font-vscode-font-family",
									"text-vscode-editor-font-size",
									"leading-vscode-editor-line-height",
									"cursor-text",
									"py-2 pl-2",
									isFocused
										? "border border-vscode-focusBorder outline outline-vscode-focusBorder"
										: isDraggingOver
											? "border-2 border-dashed border-vscode-focusBorder"
											: "border border-transparent",
									isDraggingOver
										? "bg-[color-mix(in_srgb,var(--vscode-input-background)_95%,var(--vscode-focusBorder))]"
										: "bg-vscode-input-background",
									"transition-background-color duration-150 ease-in-out",
									"will-change-background-color",
									"min-h-[94px]",
									"box-border",
									"rounded",
									"resize-none",
									"overflow-x-hidden",
									"overflow-y-auto",
									isEditMode ? "pr-20" : "pr-9",
									"flex-none flex-grow",
									"z-[2]",
									"scrollbar-none",
									"scrollbar-hide",
								)}
								onScroll={() => updateHighlights()}
							/>

							<ComposerActionButtons
								isEditMode={isEditMode}
								isStreaming={isStreaming}
								hasInputContent={hasInputContent}
								shouldDisableImages={shouldDisableImages}
								isEnhancingPrompt={isEnhancingPrompt}
								enterBehavior={enterBehavior}
								onSelectImages={onSelectImages}
								onEnhancePrompt={handleEnhancePrompt}
								onCancel={onCancel}
								onEnqueueMessage={onEnqueueMessage}
								onSend={onSend}
								onStop={onStop}
							/>

							{!inputValue && (
								<div
									className={cn(
										"absolute left-2 z-30 flex items-center h-8 font-vscode-font-family text-vscode-editor-font-size leading-vscode-editor-line-height",
										isEditMode ? "pr-20" : "pr-9",
									)}
									style={{
										bottom: "0.75rem",
										color: "color-mix(in oklab, var(--vscode-input-foreground) 50%, transparent)",
										userSelect: "none",
										pointerEvents: "none",
									}}>
									{placeholderBottomText}
								</div>
							)}
						</div>
					</div>
				</div>

				{selectedImages.length > 0 && (
					<Thumbnails
						images={selectedImages}
						setImages={setSelectedImages}
						style={{
							left: "16px",
							zIndex: 2,
							marginBottom: 0,
						}}
					/>
				)}

				<ComposerToolbar
					mode={mode}
					setMode={setMode}
					modeShortcutText={modeShortcutText}
					selectApiConfigDisabled={selectApiConfigDisabled}
					isEditMode={isEditMode}
				/>
			</div>
		)
	},
)
