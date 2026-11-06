import { applyColorEnv } from "@/lib/utils/color-env.js"

// Before ink (and with it chalk, which reads the colour variables once at
// import) is loaded by a command.
applyColorEnv(process.env)

// `timeZone` from cli-settings.json, before any command formats a date. A bad
// value is only warned about by a run (run.ts), after its screen clear.
const { loadSettings } = await import("@/lib/storage/settings.js")
const { applyTimeZoneSetting } = await import("@/lib/utils/time-zone.js")
applyTimeZoneSetting(await loadSettings().catch(() => ({})), () => {})

await import("./main.js")
