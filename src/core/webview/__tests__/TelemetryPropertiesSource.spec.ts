import { TelemetryPropertiesSource, type TelemetryPropertiesSourceHost } from "../TelemetryPropertiesSource"
import type { ProviderState } from "../ProviderStateBuilder"

// A partial state is enough: the source reads only language/mode/apiConfiguration.
const partialState = {
	language: "pl",
	mode: "code",
	apiConfiguration: { apiProvider: "anthropic" },
} as ProviderState

const baseHost: TelemetryPropertiesSourceHost = {
	getState: () => Promise.resolve(partialState),
	getCurrentTask: () => undefined,
	subagentParentOf: (_taskId: string) => undefined,
	getTaskHistoryStore: () =>
		Promise.resolve({
			get: (_taskId: string) => ({ parentTaskId: "parent-1" }),
		}),
	extensionPackageJSON: { name: "host-ext", version: "9.9.9" },
}

describe("TelemetryPropertiesSource", () => {
	test("appProperties read the host extension's packageJSON and are cached", () => {
		const source = new TelemetryPropertiesSource(baseHost)
		const first = source.getAppProperties()
		expect(first.appName).toBe("host-ext")
		expect(first.appVersion).toBe("9.9.9")
		expect(source.getAppProperties()).toBe(first)
	})

	test("gitProperties is undefined until the first getTelemetryProperties computes it", async () => {
		const source = new TelemetryPropertiesSource(baseHost)
		expect(source.getGitPropertiesIfComputed()).toBeUndefined()
		await source.getTelemetryProperties()
		expect(source.getGitPropertiesIfComputed()).toBeDefined()
	})

	test("getTelemetryProperties composes app + task facts for the current task", async () => {
		const task = {
			taskId: "t-1",
			parentTaskId: "p-1",
			todoList: [
				{ status: "completed" },
				{ status: "in_progress" },
				{ status: "pending" },
				{ status: "pending" },
			],
			api: { getModel: () => ({ id: "model-x" }) },
			diffStrategy: { getName: () => "diff-strat" },
		}
		const source = new TelemetryPropertiesSource({
			...baseHost,
			getCurrentTask: () => task as any,
		})
		const props = await source.getTelemetryProperties("t-1")
		expect(props).toMatchObject({
			appName: "host-ext",
			language: "pl",
			mode: "code",
			taskId: "t-1",
			parentTaskId: "p-1",
			isSubtask: true,
			apiProvider: "anthropic",
			modelId: "model-x",
			diffStrategy: "diff-strat",
			todos: { total: 4, completed: 1, inProgress: 1, pending: 2 },
		})
	})

	test("a non-current task id resolves lineage through subagentParentOf first", async () => {
		const source = new TelemetryPropertiesSource({
			...baseHost,
			subagentParentOf: () => "fanout-parent",
		})
		const props = await source.getTelemetryProperties("sub-9")
		expect(props).toMatchObject({ taskId: "sub-9", parentTaskId: "fanout-parent", isSubtask: true })
	})

	test("a non-current task id falls back to the history store for lineage", async () => {
		const source = new TelemetryPropertiesSource(baseHost)
		const props = await source.getTelemetryProperties("sub-9")
		expect(props).toMatchObject({ taskId: "sub-9", parentTaskId: "parent-1", isSubtask: true })
	})

	test("a throwing history store reports no parent rather than a wrong one", async () => {
		const source = new TelemetryPropertiesSource({
			...baseHost,
			getTaskHistoryStore: () => Promise.reject(new Error("store down")),
		})
		const props = await source.getTelemetryProperties("sub-9")
		expect(props).toMatchObject({ taskId: "sub-9", parentTaskId: undefined, isSubtask: false })
	})
})
