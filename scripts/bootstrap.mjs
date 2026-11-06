#!/usr/bin/env node

import { spawnSync } from "child_process"
import { readFileSync } from "fs"

if (process.env.BOOTSTRAP_IN_PROGRESS) {
	console.log("⏭️  Bootstrap already in progress, continuing with normal installation...")
	process.exit(0)
}

// If we're already using pnpm, just exit normally.
if (process.env.npm_execpath && process.env.npm_execpath.includes("pnpm")) {
	process.exit(0)
}

console.log("🚀 Bootstrapping to pnpm...")

/**
 * Run pnpm install with bootstrap environment variable.
 */
function runPnpmInstall(pnpmCommand) {
	return spawnSync(pnpmCommand, ["install"], {
		stdio: "inherit",
		shell: true,
		env: {
			...process.env,
			BOOTSTRAP_IN_PROGRESS: "1", // Set environment variable to indicate bootstrapping
		},
	})
}

try {
	// Check if pnpm is installed globally.
	const pnpmCheck = spawnSync("pnpm", ["-v"], { shell: true })

	let pnpmInstall

	if (pnpmCheck.status === 0) {
		console.log("✨ Found pnpm")
		pnpmInstall = runPnpmInstall("pnpm")
	} else {
		console.log("⚠️  Unable to find pnpm, installing it temporarily...")

		// "pnpm@<version>" from the root manifest; lifecycle scripts run in the repository root.
		const { packageManager } = JSON.parse(readFileSync("package.json", "utf8"))
		console.log(`📥 Installing ${packageManager} locally...`)

		const npmInstall = spawnSync("npm", ["install", "--no-save", packageManager], {
			stdio: "inherit",
			shell: true,
		})

		if (npmInstall.status !== 0) {
			console.error("❌ Failed to install pnpm locally")
			process.exit(1)
		}

		console.log("🔧 Running pnpm install with local installation...")
		pnpmInstall = runPnpmInstall("node_modules/.bin/pnpm")
	}

	if (pnpmInstall.status !== 0) {
		console.error("❌ pnpm install failed")
		process.exit(pnpmInstall.status)
	}

	console.log("🎉 Bootstrap completed successfully!")
	process.exit(0)
} catch (error) {
	console.error("💥 Bootstrap failed:", error.message)
	process.exit(1)
}
