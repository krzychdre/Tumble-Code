// npx vitest run src/__tests__/CloudService.environment.spec.ts
//
// Pins how CloudService picks its auth and settings services from the
// process environment, and where its retry queue persists.

import type * as vscode from "vscode"

import { CloudService } from "../CloudService.js"
import { WebAuthService } from "../WebAuthService.js"
import { StaticTokenAuthService } from "../StaticTokenAuthService.js"
import { CloudSettingsService } from "../CloudSettingsService.js"
import { StaticSettingsService } from "../StaticSettingsService.js"

vi.mock("vscode", () => ({}))
vi.mock("../WebAuthService")
vi.mock("../StaticTokenAuthService")
vi.mock("../CloudSettingsService")
vi.mock("../StaticSettingsService")
vi.mock("../CloudShareService")
vi.mock("../TelemetryClient")
vi.mock("../CloudAPI")

const makeAuthService = () => ({
	initialize: vi.fn().mockResolvedValue(undefined),
	broadcast: vi.fn().mockResolvedValue(undefined),
	on: vi.fn(),
	off: vi.fn(),
	getSessionToken: vi.fn(),
	getState: vi.fn().mockReturnValue("logged-out"),
	getUserInfo: vi.fn(),
})

const makeSettingsService = () => ({
	initialize: vi.fn().mockResolvedValue(undefined),
	on: vi.fn(),
	off: vi.fn(),
	dispose: vi.fn(),
})

describe("CloudService environment resolution (characterization)", () => {
	let context: vscode.ExtensionContext
	let workspaceState: { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
	const log = vi.fn()

	beforeEach(() => {
		CloudService.resetInstance()
		vi.stubEnv("ROO_CODE_CLOUD_TOKEN", undefined as unknown as string)
		vi.stubEnv("ROO_CODE_CLOUD_ORG_SETTINGS", undefined as unknown as string)
		workspaceState = { get: vi.fn(), update: vi.fn().mockResolvedValue(undefined) }
		context = { workspaceState } as unknown as vscode.ExtensionContext

		vi.mocked(WebAuthService).mockImplementation(() => makeAuthService() as unknown as WebAuthService)
		vi.mocked(StaticTokenAuthService).mockImplementation(
			() => makeAuthService() as unknown as StaticTokenAuthService,
		)
		vi.mocked(CloudSettingsService).mockImplementation(
			() => makeSettingsService() as unknown as CloudSettingsService,
		)
		vi.mocked(StaticSettingsService).mockImplementation(
			() => makeSettingsService() as unknown as StaticSettingsService,
		)
	})

	afterEach(() => {
		CloudService.resetInstance()
		vi.unstubAllEnvs()
		vi.clearAllMocks()
	})

	it("uses web auth and cloud settings when neither variable is set", async () => {
		const service = await CloudService.createInstance(context, log)

		expect(WebAuthService).toHaveBeenCalledWith(context, log)
		expect(StaticTokenAuthService).not.toHaveBeenCalled()
		expect(CloudSettingsService).toHaveBeenCalledTimes(1)
		expect(StaticSettingsService).not.toHaveBeenCalled()
		expect(service.isCloudAgent).toBe(false)
	})

	it("treats empty variables as unset", async () => {
		vi.stubEnv("ROO_CODE_CLOUD_TOKEN", "")
		vi.stubEnv("ROO_CODE_CLOUD_ORG_SETTINGS", "")

		const service = await CloudService.createInstance(context, log)

		expect(WebAuthService).toHaveBeenCalledTimes(1)
		expect(StaticTokenAuthService).not.toHaveBeenCalled()
		expect(CloudSettingsService).toHaveBeenCalledTimes(1)
		expect(StaticSettingsService).not.toHaveBeenCalled()
		expect(service.isCloudAgent).toBe(false)
	})

	it("uses the static token auth and marks a cloud agent when ROO_CODE_CLOUD_TOKEN is set", async () => {
		vi.stubEnv("ROO_CODE_CLOUD_TOKEN", "job-token")

		const service = await CloudService.createInstance(context, log)

		expect(StaticTokenAuthService).toHaveBeenCalledWith(context, "job-token", log)
		expect(WebAuthService).not.toHaveBeenCalled()
		expect(service.isCloudAgent).toBe(true)
	})

	it("uses static settings when ROO_CODE_CLOUD_ORG_SETTINGS is set", async () => {
		vi.stubEnv("ROO_CODE_CLOUD_ORG_SETTINGS", "eyJ2ZXJzaW9uIjoxfQ==")

		await CloudService.createInstance(context, log)

		expect(StaticSettingsService).toHaveBeenCalledWith("eyJ2ZXJzaW9uIjoxfQ==", log)
		expect(CloudSettingsService).not.toHaveBeenCalled()
	})

	it("persists its retry queue in the workspace state under roo.retryQueue", async () => {
		const service = await CloudService.createInstance(context, log)

		expect(workspaceState.get).toHaveBeenCalledWith("roo.retryQueue")

		await service.retryQueue!.enqueue("https://example.test/x", { method: "POST" }, "telemetry")

		expect(workspaceState.update).toHaveBeenCalledWith(
			"roo.retryQueue",
			expect.arrayContaining([expect.objectContaining({ url: "https://example.test/x", type: "telemetry" })]),
		)
		service.retryQueue!.dispose()
	})
})
