import { useState, useEffect } from "react"

import type { IndexingStatus, ExtensionMessage } from "@roo-code/types"

import { onExtensionMessage } from "@src/utils/extensionBus"

/**
 * The indexing status shown in the popover: seeded from the parent's value and updated by the
 * host's `indexingStatusUpdate` messages for this workspace (or messages without a workspace).
 */
export function useIndexingStatus(externalIndexingStatus: IndexingStatus, cwd: string | undefined) {
	const [indexingStatus, setIndexingStatus] = useState<IndexingStatus>(externalIndexingStatus)

	// Update indexing status from parent
	useEffect(() => {
		setIndexingStatus(externalIndexingStatus)
	}, [externalIndexingStatus])

	// Listen for indexing status updates
	useEffect(() => {
		const handleMessage = (message: ExtensionMessage) => {
			if (message.type === "indexingStatusUpdate") {
				const values = message.values as NonNullable<ExtensionMessage["values"]>
				if (!values.workspacePath || values.workspacePath === cwd) {
					setIndexingStatus({
						systemStatus: values.systemStatus,
						message: values.message || "",
						processedItems: values.processedItems,
						totalItems: values.totalItems,
						currentItemUnit: values.currentItemUnit || "items",
					})
				}
			}
		}

		return onExtensionMessage("indexingStatusUpdate", handleMessage)
	}, [cwd])

	return indexingStatus
}
