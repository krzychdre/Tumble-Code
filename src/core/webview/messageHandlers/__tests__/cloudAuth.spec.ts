// npx vitest run core/webview/messageHandlers/__tests__/cloudAuth.spec.ts

const cloud = vi.hoisted(() => ({
	login: vi.fn(),
	logout: vi.fn(),
	handleAuthCallback: vi.fn(),
}))

vi.mock("vscode", () => ({
	window: { showErrorMessage: vi.fn(), showInformationMessage: vi.fn() },
	Uri: { parse: (value: string) => ({ query: new URL(value).search.slice(1) }) },
}))
vi.mock("@tumble-code/cloud", () => ({ CloudService: { instance: cloud } }))
vi.mock("@tumble-code/telemetry", () => ({ TelemetryService: { instance: { captureEvent: vi.fn() } } }))
vi.mock("../../../../i18n", () => ({ t: (key: string) => key }))
const cloudStart = vi.hoisted(() => ({ waitForCloudStart: vi.fn(async () => {}) }))
vi.mock("../../../../extension/cloudStartup", () => cloudStart)

import type { HandlerContext } from "../context"
import { cloudAuthHandlers } from "../cloudAuth"

function makeContext() {
	const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
	const postStateToWebview = vi.fn().mockResolvedValue(undefined)
	return {
		ctx: { provider: { postMessageToWebview, postStateToWebview } } as unknown as HandlerContext,
		postMessageToWebview,
	}
}

describe("cloud sign-in handlers", () => {
	beforeEach(() => vi.clearAllMocks())

	it("rooCloudSignIn keeps the editor's deep link when no auth redirect is given", async () => {
		const { ctx, postMessageToWebview } = makeContext()

		await cloudAuthHandlers.rooCloudSignIn!(ctx, { type: "rooCloudSignIn" })

		expect(cloud.login).toHaveBeenCalledWith()
		expect(postMessageToWebview).not.toHaveBeenCalled()
	})

	it("rooCloudSignIn passes the CLI's loopback auth redirect to the cloud", async () => {
		const { ctx } = makeContext()

		await cloudAuthHandlers.rooCloudSignIn!(ctx, { type: "rooCloudSignIn", authRedirect: "http://127.0.0.1:53682" })

		expect(cloud.login).toHaveBeenCalledWith({ authRedirect: "http://127.0.0.1:53682" })
	})

	// The CLI's /login can arrive while the cloud is still starting in the background.
	it("rooCloudSignIn waits for the background cloud start", async () => {
		let finishStart: () => void = () => {}
		cloudStart.waitForCloudStart.mockReturnValueOnce(new Promise<void>((resolve) => (finishStart = resolve)))
		const { ctx } = makeContext()

		const handled = cloudAuthHandlers.rooCloudSignIn!(ctx, {
			type: "rooCloudSignIn",
			authRedirect: "http://127.0.0.1:53682",
		})
		await Promise.resolve()
		expect(cloud.login).not.toHaveBeenCalled()

		finishStart()
		await handled
		expect(cloud.login).toHaveBeenCalledTimes(1)
	})

	it("rooCloudSignIn reports a failed start as a cloudAuthResult", async () => {
		cloud.login.mockRejectedValueOnce(new Error("auth redirect must be a loopback address"))
		const { ctx, postMessageToWebview } = makeContext()

		await cloudAuthHandlers.rooCloudSignIn!(ctx, { type: "rooCloudSignIn", authRedirect: "http://evil.example" })

		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "cloudAuthResult",
			text: "rooCloudSignIn",
			success: false,
			error: "auth redirect must be a loopback address",
		})
	})

	it("rooCloudManualUrl exchanges the callback and reports success", async () => {
		const { ctx, postMessageToWebview } = makeContext()

		await cloudAuthHandlers.rooCloudManualUrl!(ctx, {
			type: "rooCloudManualUrl",
			text: "http://127.0.0.1:53682/auth/clerk/callback?code=t1&state=s1",
		})

		expect(cloud.handleAuthCallback).toHaveBeenCalledWith("t1", "s1", null)
		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "cloudAuthResult",
			text: "rooCloudManualUrl",
			success: true,
		})
	})

	it("rooCloudManualUrl reports a failed exchange", async () => {
		cloud.handleAuthCallback.mockRejectedValueOnce(new Error("Invalid state parameter"))
		const { ctx, postMessageToWebview } = makeContext()

		await cloudAuthHandlers.rooCloudManualUrl!(ctx, {
			type: "rooCloudManualUrl",
			text: "http://127.0.0.1:53682/auth/clerk/callback?code=t1&state=forged",
		})

		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "cloudAuthResult",
			text: "rooCloudManualUrl",
			success: false,
			error: "Invalid state parameter",
		})
	})

	it("rooCloudSignOut reports success and failure", async () => {
		const { ctx, postMessageToWebview } = makeContext()

		await cloudAuthHandlers.rooCloudSignOut!(ctx, { type: "rooCloudSignOut" })
		expect(postMessageToWebview).toHaveBeenLastCalledWith({
			type: "cloudAuthResult",
			text: "rooCloudSignOut",
			success: true,
		})

		cloud.logout.mockRejectedValueOnce(new Error("disk full"))
		await cloudAuthHandlers.rooCloudSignOut!(ctx, { type: "rooCloudSignOut" })
		expect(postMessageToWebview).toHaveBeenLastCalledWith({
			type: "cloudAuthResult",
			text: "rooCloudSignOut",
			success: false,
			error: "disk full",
		})
	})
})
