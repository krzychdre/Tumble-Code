// Runs the real `uuid` package (no module mock) to pin the identifiers that
// outlive a single process. Qdrant point IDs are uuid v5 of the segment hash in
// QDRANT_CODE_BLOCK_NAMESPACE (scanner.ts, file-watcher.ts) and the indexing
// metadata point uses a fixed name (qdrant-client.ts). If a `uuid` upgrade
// changed these values, an existing index would get duplicate points and lose
// its "indexing complete" marker, so they are pinned as literals.
import { v4 as uuidv4, v5 as uuidv5, v7 as uuidv7, validate, version } from "uuid"

import { QDRANT_CODE_BLOCK_NAMESPACE } from "../constants"

describe("uuid identifiers used by the extension", () => {
	it("keeps the v5 point ID of the indexing metadata point", () => {
		expect(uuidv5("__indexing_metadata__", QDRANT_CODE_BLOCK_NAMESPACE)).toBe(
			"f70bfc2c-6e82-5456-9c20-33b51942337c",
		)
	})

	it("keeps the v5 point ID derived from a segment hash", () => {
		const segmentHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
		expect(uuidv5(segmentHash, QDRANT_CODE_BLOCK_NAMESPACE)).toBe("2f065d34-8b38-5f95-8ada-8d2b99c74898")
	})

	it("creates time-ordered v7 IDs for tasks and provider sessions", () => {
		const first = uuidv7()
		const second = uuidv7()
		expect(validate(first)).toBe(true)
		expect(version(first)).toBe(7)
		// Task IDs sort by creation time; v7 is monotonic within a process.
		expect(second > first).toBe(true)
		// The first 48 bits are the Unix time in milliseconds.
		const millis = parseInt(first.replace(/-/g, "").slice(0, 12), 16)
		expect(Math.abs(millis - Date.now())).toBeLessThan(60_000)
	})

	it("creates random v4 IDs for queued messages", () => {
		const id = uuidv4()
		expect(validate(id)).toBe(true)
		expect(version(id)).toBe(4)
		expect(uuidv4()).not.toBe(id)
	})
})
