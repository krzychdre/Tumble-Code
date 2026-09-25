// Export existing hooks
export { TerminalSizeProvider, useTerminalSize } from "./TerminalSizeContext.js"
export { useToast, useToastStore } from "./useToast.js"
export { useInputHistory } from "./useInputHistory.js"

// Export new extracted hooks
export { useFollowupCountdown } from "./useFollowupCountdown.js"
export { useTranscriptSink } from "./useTranscriptSink.js"
export { useExtensionHost } from "./useExtensionHost.js"
export { useTaskSubmit } from "./useTaskSubmit.js"
export { useGlobalInput } from "./useGlobalInput.js"
export { usePickerHandlers } from "./usePickerHandlers.js"
export { useTranscriptPromotion } from "./useTranscriptPromotion.js"
export { useMcpPanel } from "./useMcpPanel.js"
export { useAutocompleteTriggers } from "./useAutocompleteTriggers.js"
export { useSecretPromptBridge } from "./useSecretPromptBridge.js"

// Export types
export type { UseFollowupCountdownOptions } from "./useFollowupCountdown.js"
export type { UseTranscriptSinkOptions } from "./useTranscriptSink.js"
export type { UseExtensionHostOptions, UseExtensionHostReturn } from "./useExtensionHost.js"
export type { UseTaskSubmitOptions, UseTaskSubmitReturn } from "./useTaskSubmit.js"
export type { UseGlobalInputOptions } from "./useGlobalInput.js"
export type { UsePickerHandlersOptions, UsePickerHandlersReturn } from "./usePickerHandlers.js"
