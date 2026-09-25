import { useEffect, useRef, useState } from "react"

import { vscode } from "@src/utils/vscode"
import type { ExtensionMessage } from "@roo-code/types"
import { onExtensionMessage } from "@src/utils/extensionBus"

export type ImportLevel = "global" | "project"

type UseModeImportExportOptions = {
	/** The mode shown in the view; undefined when it is not a known mode. */
	currentSlug: string | undefined
	/** Called with the slug of a successfully imported mode. */
	onImported: (slug: string) => void
}

/**
 * Import and export of a mode through the host: the busy flags that block a second request
 * until the host answers, the import dialog with its level, and the one-time "does this mode
 * have rules to export" check per mode.
 */
export function useModeImportExport({ currentSlug, onImported }: UseModeImportExportOptions) {
	const [isExporting, setIsExporting] = useState(false)
	const [isImporting, setIsImporting] = useState(false)
	const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
	const [importLevel, setImportLevel] = useState<ImportLevel>("project")
	const [hasRulesToExport, setHasRulesToExport] = useState<Record<string, boolean>>({})

	// The message listener is registered once; it calls the latest callback through this ref.
	const onImportedRef = useRef(onImported)
	useEffect(() => {
		onImportedRef.current = onImported
	}, [onImported])

	useEffect(() => {
		if (currentSlug && hasRulesToExport[currentSlug] === undefined) {
			vscode.postMessage({ type: "checkRulesDirectory", slug: currentSlug })
		}
	}, [currentSlug, hasRulesToExport])

	useEffect(() => {
		const handler = (message: ExtensionMessage) => {
			if (message.type === "exportModeResult") {
				setIsExporting(false)
				if (!message.success) {
					console.error("Failed to export mode:", message.error)
				}
			} else if (message.type === "importModeResult") {
				setIsImporting(false)
				setIsImportDialogOpen(false)
				if (message.success) {
					if (message.slug) {
						onImportedRef.current(message.slug)
					}
				} else if (message.error !== "cancelled") {
					console.error("Failed to import mode:", message.error)
				}
			} else if (message.type === "checkRulesDirectoryResult") {
				// The host always sends both; the casts only restate what the untyped listener assumed.
				const slug = message.slug as string
				const hasContent = message.hasContent as boolean
				setHasRulesToExport((prev) => ({ ...prev, [slug]: hasContent }))
			}
		}

		return onExtensionMessage(["exportModeResult", "importModeResult", "checkRulesDirectoryResult"], handler)
	}, [])

	const exportMode = (slug: string) => {
		if (isExporting) return
		setIsExporting(true)
		vscode.postMessage({ type: "exportMode", slug })
	}

	/** Every opening starts at the project level. */
	const openImportDialog = () => {
		setImportLevel("project")
		setIsImportDialogOpen(true)
	}

	const closeImportDialog = () => setIsImportDialogOpen(false)

	const startImport = () => {
		if (isImporting) return
		setIsImporting(true)
		vscode.postMessage({ type: "importMode", source: importLevel })
	}

	return {
		isExporting,
		isImporting,
		isImportDialogOpen,
		importLevel,
		setImportLevel,
		exportMode,
		openImportDialog,
		closeImportDialog,
		startImport,
	}
}
