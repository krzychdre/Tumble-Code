import { Text } from "ink"
import { render } from "ink-testing-library"
import pWaitFor from "p-wait-for"

import type { ExtensionHostInterface, ExtensionHostOptions } from "@/agent/index.js"

import { useCLIStore } from "../../store.js"
import { useExtensionHost } from "../useExtensionHost.js"

describe("useExtensionHost", () => {
	beforeEach(() => {
		useCLIStore.getState().reset()
	})

	it("hands every host option to the extension host, with output disabled", async () => {
		const options: ExtensionHostOptions = {
			mode: "architect",
			reasoningEffort: "high",
			consecutiveMistakeLimit: 3,
			user: null,
			provider: "openai",
			apiKey: "1111",
			model: "GLM-5.3-Flash-NVFP4",
			baseUrl: "http://192.168.50.194:11111/v1",
			modeProviderSettings: { base: { apiProvider: "openai" }, modes: {} },
			workspacePath: "/tmp/ws",
			extensionPath: "/tmp/ext",
			nonInteractive: true,
			ephemeral: false,
			debug: false,
			exitOnComplete: false,
			terminalShell: "/bin/zsh",
			exitOnError: true,
		}

		const createExtensionHost = vi.fn((_options: ExtensionHostOptions) => {
			const host = {
				on: vi.fn(),
				client: { on: vi.fn() },
				activate: vi.fn(async () => {}),
				sendToExtension: vi.fn(),
			}
			return host as unknown as ExtensionHostInterface
		})

		function Harness() {
			useExtensionHost({ ...options, onExtensionMessage: vi.fn(), createExtensionHost })
			return <Text>harness</Text>
		}

		render(<Harness />)
		await pWaitFor(() => createExtensionHost.mock.calls.length > 0, { timeout: 2000 })

		expect(createExtensionHost).toHaveBeenCalledWith({ ...options, disableOutput: true })
	})
})
