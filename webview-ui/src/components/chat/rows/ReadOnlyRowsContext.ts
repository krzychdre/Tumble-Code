import { createContext, useContext } from "react"

/**
 * True while chat rows render a transcript that is not the open task's (a
 * subagent's, see SubagentTranscriptView). Row actions that act on the open
 * task (edit or delete a message, abort the running command) are hidden
 * then: they would reach the open task instead of the shown one.
 */
export const ReadOnlyRowsContext = createContext(false)

export const useReadOnlyRows = () => useContext(ReadOnlyRowsContext)
