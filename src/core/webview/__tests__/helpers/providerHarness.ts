// Shared fakes for the ClineProvider specs: a stateful extension context, an
// output channel, a webview view, and a provider built on them.
// The `vscode` module itself comes from src/__mocks__/vscode.js.

import * as vscode from "vscode"

import { ContextProxy } from "../../../config/ContextProxy"
import { ClineProvider } from "../../ClineProvider"

/** An extension context whose global state, workspace state and secrets keep what is written. */
export const createMockContext = (): vscode.ExtensionContext => {
	const globalState: Record<string, unknown> = { mode: "code", currentApiConfigName: "default-profile" }
	const workspaceState: Record<string, unknown> = {}
	const secrets: Record<string, string | undefined> = {}
	return {
		extensionPath: "/test/path",
		extensionUri: {} as vscode.Uri,
		globalState: {
			get: vi.fn().mockImplementation((key: string) => globalState[key]),
			update: vi.fn().mockImplementation((key: string, value: unknown) => {
				globalState[key] = value
				return Promise.resolve()
			}),
			keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
		},
		secrets: {
			get: vi.fn().mockImplementation((key: string) => secrets[key]),
			store: vi.fn().mockImplementation((key: string, value: string | undefined) => {
				secrets[key] = value
				return Promise.resolve()
			}),
			delete: vi.fn().mockImplementation((key: string) => {
				delete secrets[key]
				return Promise.resolve()
			}),
		},
		workspaceState: {
			get: vi
				.fn()
				.mockImplementation((key: string, defaultValue?: unknown) =>
					key in workspaceState ? workspaceState[key] : defaultValue,
				),
			update: vi.fn().mockImplementation((key: string, value: unknown) => {
				workspaceState[key] = value
				return Promise.resolve()
			}),
			keys: vi.fn().mockImplementation(() => Object.keys(workspaceState)),
		},
		subscriptions: [],
		extension: { packageJSON: { version: "1.0.0" } },
		globalStorageUri: { fsPath: "/test/storage/path" },
	} as unknown as vscode.ExtensionContext
}

const createMockOutputChannel = () =>
	({
		appendLine: vi.fn(),
		clear: vi.fn(),
		dispose: vi.fn(),
	}) as unknown as vscode.OutputChannel

/** The sidebar: a WebviewView. */
export const createMockWebviewView = () =>
	({
		webview: {
			postMessage: vi.fn().mockResolvedValue(true),
			html: "",
			options: {},
			onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
			asWebviewUri: vi.fn(),
			cspSource: "vscode-webview://test-csp-source",
		},
		visible: true,
		onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
		onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
	}) as unknown as vscode.WebviewView

const mcpHubStub = () => ({
	listTools: vi.fn().mockResolvedValue([]),
	callTool: vi.fn().mockResolvedValue({ content: [] }),
	listResources: vi.fn().mockResolvedValue([]),
	readResource: vi.fn().mockResolvedValue({ contents: [] }),
	getAllServers: vi.fn().mockReturnValue([]),
})

/** A provider on the given context, with an MCP hub that has no servers. */
export const createTestProvider = (context: vscode.ExtensionContext) => {
	const provider = new ClineProvider(context, createMockOutputChannel(), "sidebar", new ContextProxy(context))
	provider.getMcpHub = vi.fn().mockReturnValue(mcpHubStub())
	return provider
}
