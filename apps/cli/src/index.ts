import { applyColorEnv } from "@/lib/utils/color-env.js"
import { loadReactProductionBuilds } from "@/lib/utils/react-production.js"

// Before ink (and with it chalk, which reads the colour variables once at
// import) is loaded below.
applyColorEnv(process.env)

// React has to be loaded before anything else imports it (see
// react-production.ts). A static import of the CLI would be evaluated before
// this line, so the CLI is loaded with a dynamic one.
await loadReactProductionBuilds()

await import("./main.js")
