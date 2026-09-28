import type { ViteUserConfig } from "vitest/config"

type TestConfig = NonNullable<ViteUserConfig["test"]>

export declare const sharedTestConfig: Pick<TestConfig, "globals" | "environment" | "watch" | "exclude">

export declare function defineRooVitestConfig(overrides?: ViteUserConfig): ViteUserConfig

export declare function resolveVerbosity(
	argv?: readonly string[],
	env?: Record<string, string | undefined>,
): {
	silent: boolean
	reporters: string[]
	onConsoleLog: (log: string, type: "stdout" | "stderr") => false | void
}
