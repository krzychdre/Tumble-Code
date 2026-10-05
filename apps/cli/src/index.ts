import { applyColorEnv } from "@/lib/utils/color-env.js"
import { loadReactProductionBuilds } from "@/lib/utils/react-production.js"

// Before ink (and with it chalk, which reads the colour variables once at
// import) is loaded below.
applyColorEnv(process.env)

// React has to be loaded before anything else imports it (see
// react-production.ts). A static import of the CLI would be evaluated before
// this line, so the CLI is loaded with a dynamic one.
await loadReactProductionBuilds()

// `timeZone` from cli-settings.json, before any command formats a date. A bad
// value is only warned about by a run (run.ts), after its screen clear.
const { loadSettings } = await import("@/lib/storage/settings.js")
const { applyTimeZoneSetting } = await import("@/lib/utils/time-zone.js")
applyTimeZoneSetting(await loadSettings().catch(() => ({})), () => {})

await import("./main.js")
