import * as core from "@roo-code/core"

import * as shim from "../safeWriteJson"

// The implementation lives in packages/core (src/fs/safeWriteJson.ts). This file only
// guards the compatibility re-export in src/utils/safeWriteJson.ts, which the extension
// modules import and about 25 specs vi.mock by path.
describe("src/utils/safeWriteJson re-export", () => {
	it("forwards the implementation from @roo-code/core", () => {
		expect(shim.safeWriteJson).toBe(core.safeWriteJson)
		expect(shim.withLockedJsonTransaction).toBe(core.withLockedJsonTransaction)
		expect(shim.LockCompromisedError).toBe(core.LockCompromisedError)
	})
})
