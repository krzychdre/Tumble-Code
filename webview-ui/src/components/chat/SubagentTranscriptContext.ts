import { createContext, useContext } from "react"

/**
 * Opens the full transcript of a parallel subagent (SubagentTranscriptView).
 * App provides it; the subagents panel and the history rows of a subagent
 * call it. The default does nothing, so a component rendered outside App
 * (a test) needs no provider.
 */
export const SubagentTranscriptContext = createContext<(taskId: string) => void>(() => {})

export const useOpenSubagentTranscript = () => useContext(SubagentTranscriptContext)
