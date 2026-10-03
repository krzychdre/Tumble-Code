// pnpm --filter @tumble-code/types exec vitest run src/__tests__/cli-runtime.spec.ts

import {
	CLI_RUNTIME_ENV,
	CLI_RUNTIME_GLOBAL_SLOTS,
	type CliExtensionHostSlot,
	type CliRuntimeEnv,
	type CliRuntimeEnvName,
	type CliRuntimeGlobals,
	clearCliRuntimeGlobals,
	readCliRuntimeEnv,
	setCliRuntimeGlobals,
} from "../index.js"

describe("CLI runtime contract", () => {
	describe("CLI_RUNTIME_ENV", () => {
		it("names every environment variable the CLI and the extension share", () => {
			expect(CLI_RUNTIME_ENV).toEqual({
				runtime: "ROO_CLI_RUNTIME",
				codexAuthOnly: "ROO_CLI_CODEX_AUTH_ONLY",
				cloudAuthOnly: "ROO_CLI_CLOUD_AUTH_ONLY",
				mcpSettingsPath: "ROO_MCP_SETTINGS_PATH",
				cliVersion: "ROO_CLI_VERSION",
				cliRoot: "ROO_CLI_ROOT",
				extensionPath: "ROO_EXTENSION_PATH",
				ripgrepPath: "ROO_RIPGREP_PATH",
			})
		})

		it("types the names as a closed union", () => {
			expectTypeOf<CliRuntimeEnvName>().toEqualTypeOf<
				| "ROO_CLI_RUNTIME"
				| "ROO_CLI_CODEX_AUTH_ONLY"
				| "ROO_CLI_CLOUD_AUTH_ONLY"
				| "ROO_MCP_SETTINGS_PATH"
				| "ROO_CLI_VERSION"
				| "ROO_CLI_ROOT"
				| "ROO_EXTENSION_PATH"
				| "ROO_RIPGREP_PATH"
			>()
		})
	})

	describe("readCliRuntimeEnv", () => {
		it("reports a plain VS Code process as not the CLI", () => {
			expect(readCliRuntimeEnv({})).toEqual({
				isCliRuntime: false,
				codexAuthOnly: false,
				cloudAuthOnly: false,
				mcpSettingsPath: undefined,
				cliVersion: undefined,
				cliRoot: undefined,
				extensionPath: undefined,
				ripgrepPath: undefined,
			})
		})

		it("reads every variable with the same rules the call sites used", () => {
			const env = readCliRuntimeEnv({
				ROO_CLI_RUNTIME: "1",
				ROO_CLI_CODEX_AUTH_ONLY: "1",
				ROO_CLI_CLOUD_AUTH_ONLY: "1",
				ROO_MCP_SETTINGS_PATH: "  /home/u/.roo/mcp.json  ",
				ROO_CLI_VERSION: "0.2.0",
				ROO_CLI_ROOT: "/opt/cli",
				ROO_EXTENSION_PATH: "/opt/cli/extension",
				ROO_RIPGREP_PATH: "/opt/cli/bin/rg",
			})

			expect(env).toEqual({
				isCliRuntime: true,
				codexAuthOnly: true,
				cloudAuthOnly: true,
				mcpSettingsPath: "/home/u/.roo/mcp.json",
				cliVersion: "0.2.0",
				cliRoot: "/opt/cli",
				extensionPath: "/opt/cli/extension",
				ripgrepPath: "/opt/cli/bin/rg",
			})
		})

		it("treats only the exact string 1 as on for the flags", () => {
			expect(
				readCliRuntimeEnv({
					ROO_CLI_RUNTIME: "true",
					ROO_CLI_CODEX_AUTH_ONLY: "yes",
					ROO_CLI_CLOUD_AUTH_ONLY: "on",
				}),
			).toMatchObject({
				isCliRuntime: false,
				codexAuthOnly: false,
				cloudAuthOnly: false,
			})
		})

		it("treats empty and blank strings as unset", () => {
			expect(
				readCliRuntimeEnv({
					ROO_MCP_SETTINGS_PATH: "   ",
					ROO_CLI_VERSION: "",
					ROO_CLI_ROOT: "",
					ROO_EXTENSION_PATH: "",
					ROO_RIPGREP_PATH: "",
				}),
			).toMatchObject({
				mcpSettingsPath: undefined,
				cliVersion: undefined,
				cliRoot: undefined,
				extensionPath: undefined,
				ripgrepPath: undefined,
			})
		})

		it("returns a typed record", () => {
			expectTypeOf(readCliRuntimeEnv).returns.toEqualTypeOf<CliRuntimeEnv>()
			expectTypeOf<CliRuntimeEnv["isCliRuntime"]>().toEqualTypeOf<boolean>()
			expectTypeOf<CliRuntimeEnv["ripgrepPath"]>().toEqualTypeOf<string | undefined>()
		})
	})

	describe("global slots", () => {
		const target: CliRuntimeGlobals = {}
		const host: CliExtensionHostSlot = {
			registerWebviewProvider: () => {},
			unregisterWebviewProvider: () => {},
			isInInitialSetup: () => false,
			markWebviewReady: () => {},
			emit: () => true,
			on: () => host,
		}

		it("names the two globalThis slots", () => {
			expect(CLI_RUNTIME_GLOBAL_SLOTS).toEqual({ vscode: "vscode", extensionHost: "__extensionHost" })
		})

		it("writes both slots and clears them again", () => {
			const vscode = { window: {} }

			setCliRuntimeGlobals({ vscode, extensionHost: host }, target)

			expect(target.vscode).toBe(vscode)
			expect(target.__extensionHost).toBe(host)

			clearCliRuntimeGlobals(target)

			expect("vscode" in target).toBe(false)
			expect("__extensionHost" in target).toBe(false)
		})

		it("types the slots", () => {
			expectTypeOf<CliRuntimeGlobals["__extensionHost"]>().toEqualTypeOf<CliExtensionHostSlot | undefined>()
			expectTypeOf<CliRuntimeGlobals["vscode"]>().toEqualTypeOf<unknown>()
		})
	})
})
