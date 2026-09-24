// The implementation lives in packages/core (src/fs/safeWriteJson.ts). This re-export keeps
// the extension's import path stable, and with it the vi.mock("../utils/safeWriteJson")
// calls in the specs, which only take effect when the code under test imports this path.
export * from "@roo-code/core/fs"
