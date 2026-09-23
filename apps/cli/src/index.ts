import { loadReactProductionBuilds } from "@/lib/utils/react-production.js"

// React has to be loaded before anything else imports it (see
// react-production.ts). A static import of the CLI would be evaluated before
// this line, so the CLI is loaded with a dynamic one.
loadReactProductionBuilds()

await import("./main.js")
