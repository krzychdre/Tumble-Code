import * as vscode from "vscode"

import { Package } from "../../../shared/package"

import { BATCH_SEGMENT_THRESHOLD } from "../constants"

/**
 * The configurable number of code segments embedded per request. Read at the point of use so a
 * mid-session change of the setting applies without recreating the services.
 */
export function embeddingBatchSize(): number {
	return vscode.workspace
		.getConfiguration(Package.name)
		.get<number>("codeIndex.embeddingBatchSize", BATCH_SEGMENT_THRESHOLD)
}
