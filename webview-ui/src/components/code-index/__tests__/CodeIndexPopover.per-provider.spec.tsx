/**
 * Per embedder provider behaviour of the code index settings form.
 *
 * For each of the 8 embedder providers the popover shows its own fields. These
 * tests pin, per provider:
 * - which validation errors appear when Save is pressed with the required
 *   fields empty (nothing is sent to the extension then);
 * - the exact `saveCodeIndexSettingsAtomic` payload after the required fields
 *   are filled;
 * - for providers with an API key: a stored key (shown as a placeholder) counts
 *   as valid and is not sent back, so the extension keeps the saved secret.
 */

import React from "react"

import { render, screen, fireEvent, act } from "@/utils/test-utils"
import { PopoverTrigger } from "@/components/ui"
import { vscode } from "@/utils/vscode"

import type { EmbedderProvider } from "@roo-code/types"

import { CodeIndexPopover } from "../CodeIndexPopover"

vi.mock("react-i18next", () => ({
	Trans: ({ children }: any) => <>{children}</>,
	useTranslation: () => ({ t: (key: string) => key }),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("@/components/ui/hooks/useOpenRouterModelProviders", () => ({
	useOpenRouterModelProviders: () => ({ data: undefined, isLoading: false }),
	OPENROUTER_DEFAULT_PROVIDER_NAME: "[default]",
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
	VSCodeTextField: ({ value, onInput, onBlur, placeholder, className, type }: any) => (
		<input
			type={type ?? "text"}
			value={value ?? ""}
			placeholder={placeholder}
			className={className}
			onChange={(e: any) => onInput?.({ target: { value: e.target.value } })}
			onBlur={(e: any) => onBlur?.({ target: { value: e.target.value } })}
		/>
	),
	VSCodeDropdown: ({ children, value, onChange, className }: any) => (
		<select
			data-testid="model-dropdown"
			value={value ?? ""}
			className={className}
			onChange={(e: any) => onChange?.({ target: { value: e.target.value } })}>
			{children}
		</select>
	),
	VSCodeOption: ({ children, value }: any) => <option value={value}>{children}</option>,
}))

const MODELS = {
	openai: { "text-embedding-3-small": { dimension: 1536 } },
	gemini: { "gemini-embedding-001": { dimension: 3072 } },
	mistral: { "codestral-embed-2505": { dimension: 1536 } },
	"vercel-ai-gateway": { "openai/text-embedding-3-small": { dimension: 1536 } },
	bedrock: { "amazon.titan-embed-text-v2:0": { dimension: 1024 } },
	openrouter: { "openai/text-embedding-3-small": { dimension: 1536 } },
}

const mockExtensionState: any = {
	codebaseIndexConfig: undefined,
	codebaseIndexModels: MODELS,
	cwd: "/workspace",
	apiConfiguration: {},
}

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState,
}))

const indexingStatus = {
	systemStatus: "Standby",
	message: "",
	processedItems: 0,
	totalItems: 0,
	currentItemUnit: "items",
}

const QDRANT_URL = "http://qdrant.local:6333"

type TextInput = { placeholder: string; value: string }

type ProviderCase = {
	provider: EmbedderProvider
	/** Text inputs (found by placeholder) the user fills, in order. */
	inputs: TextInput[]
	/** The model is picked from a dropdown (value) or typed (undefined: part of `inputs`). */
	dropdownModel?: string
	/** Translated validation messages shown when the required fields stay empty. */
	emptyErrors: string[]
	/** Fields the payload must carry after filling. */
	payload: Record<string, unknown>
	/** The secret field of this provider, if it has an API key. */
	secretField?: string
	/** The `codeIndexSecretStatus` flag reporting that secret as stored. */
	secretFlag?: string
}

const CASES: ProviderCase[] = [
	{
		provider: "openai",
		inputs: [{ placeholder: "settings:codeIndex.openAiKeyPlaceholder", value: "sk-openai" }],
		dropdownModel: "text-embedding-3-small",
		emptyErrors: [
			"settings:codeIndex.validation.openaiApiKeyRequired",
			"settings:codeIndex.validation.modelSelectionRequired",
		],
		payload: { codeIndexOpenAiKey: "sk-openai", codebaseIndexEmbedderModelId: "text-embedding-3-small" },
		secretField: "codeIndexOpenAiKey",
		secretFlag: "hasOpenAiKey",
	},
	{
		provider: "ollama",
		inputs: [
			{ placeholder: "settings:codeIndex.ollamaUrlPlaceholder", value: "http://ollama.local:11434" },
			{ placeholder: "settings:codeIndex.modelPlaceholder", value: "nomic-embed-text" },
			{ placeholder: "settings:codeIndex.modelDimensionPlaceholder", value: "768" },
		],
		// An empty URL fails both `min(1)` and `url()`; the "required" message must win over "invalid".
		emptyErrors: [
			"settings:codeIndex.validation.ollamaBaseUrlRequired",
			"settings:codeIndex.validation.modelIdRequired",
		],
		payload: {
			codebaseIndexEmbedderBaseUrl: "http://ollama.local:11434",
			codebaseIndexEmbedderModelId: "nomic-embed-text",
			codebaseIndexEmbedderModelDimension: 768,
		},
	},
	{
		provider: "openai-compatible",
		inputs: [
			{
				placeholder: "settings:codeIndex.openAiCompatibleBaseUrlPlaceholder",
				value: "http://embeddings.local/v1",
			},
			{ placeholder: "settings:codeIndex.openAiCompatibleApiKeyPlaceholder", value: "sk-compat" },
			{ placeholder: "settings:codeIndex.modelPlaceholder", value: "bge-m3" },
			{ placeholder: "settings:codeIndex.modelDimensionPlaceholder", value: "1024" },
		],
		emptyErrors: [
			"settings:codeIndex.validation.baseUrlRequired",
			"settings:codeIndex.validation.apiKeyRequired",
			"settings:codeIndex.validation.modelIdRequired",
			// An empty dimension is `undefined`; the translated message must show, not zod's own "Required".
			"settings:codeIndex.validation.modelDimensionRequired",
		],
		payload: {
			codebaseIndexOpenAiCompatibleBaseUrl: "http://embeddings.local/v1",
			codebaseIndexOpenAiCompatibleApiKey: "sk-compat",
			codebaseIndexEmbedderModelId: "bge-m3",
			codebaseIndexEmbedderModelDimension: 1024,
		},
		secretField: "codebaseIndexOpenAiCompatibleApiKey",
		secretFlag: "hasOpenAiCompatibleApiKey",
	},
	{
		provider: "gemini",
		inputs: [{ placeholder: "settings:codeIndex.geminiApiKeyPlaceholder", value: "gm-key" }],
		dropdownModel: "gemini-embedding-001",
		emptyErrors: [
			"settings:codeIndex.validation.geminiApiKeyRequired",
			"settings:codeIndex.validation.modelSelectionRequired",
		],
		payload: { codebaseIndexGeminiApiKey: "gm-key", codebaseIndexEmbedderModelId: "gemini-embedding-001" },
		secretField: "codebaseIndexGeminiApiKey",
		secretFlag: "hasGeminiApiKey",
	},
	{
		provider: "mistral",
		inputs: [{ placeholder: "settings:codeIndex.mistralApiKeyPlaceholder", value: "ms-key" }],
		dropdownModel: "codestral-embed-2505",
		emptyErrors: [
			"settings:codeIndex.validation.mistralApiKeyRequired",
			"settings:codeIndex.validation.modelSelectionRequired",
		],
		payload: { codebaseIndexMistralApiKey: "ms-key", codebaseIndexEmbedderModelId: "codestral-embed-2505" },
		secretField: "codebaseIndexMistralApiKey",
		secretFlag: "hasMistralApiKey",
	},
	{
		provider: "vercel-ai-gateway",
		inputs: [{ placeholder: "settings:codeIndex.vercelAiGatewayApiKeyPlaceholder", value: "vc-key" }],
		dropdownModel: "openai/text-embedding-3-small",
		emptyErrors: [
			"settings:codeIndex.validation.vercelAiGatewayApiKeyRequired",
			"settings:codeIndex.validation.modelSelectionRequired",
		],
		payload: {
			codebaseIndexVercelAiGatewayApiKey: "vc-key",
			codebaseIndexEmbedderModelId: "openai/text-embedding-3-small",
		},
		secretField: "codebaseIndexVercelAiGatewayApiKey",
		secretFlag: "hasVercelAiGatewayApiKey",
	},
	{
		provider: "bedrock",
		inputs: [
			{ placeholder: "settings:codeIndex.bedrockRegionPlaceholder", value: "eu-central-1" },
			{ placeholder: "settings:codeIndex.bedrockProfilePlaceholder", value: "work" },
		],
		dropdownModel: "amazon.titan-embed-text-v2:0",
		emptyErrors: [
			"settings:codeIndex.validation.bedrockRegionRequired",
			"settings:codeIndex.validation.modelSelectionRequired",
		],
		payload: {
			codebaseIndexBedrockRegion: "eu-central-1",
			codebaseIndexBedrockProfile: "work",
			codebaseIndexEmbedderModelId: "amazon.titan-embed-text-v2:0",
		},
	},
	{
		provider: "openrouter",
		inputs: [{ placeholder: "settings:codeIndex.openRouterApiKeyPlaceholder", value: "or-key" }],
		dropdownModel: "openai/text-embedding-3-small",
		emptyErrors: [
			"settings:codeIndex.validation.openRouterApiKeyRequired",
			"settings:codeIndex.validation.modelSelectionRequired",
		],
		payload: {
			codebaseIndexOpenRouterApiKey: "or-key",
			codebaseIndexEmbedderModelId: "openai/text-embedding-3-small",
		},
		secretField: "codebaseIndexOpenRouterApiKey",
		secretFlag: "hasOpenRouterApiKey",
	},
]

/** The "invalid URL" messages must never show for an empty URL field. */
const INVALID_URL_KEYS = [
	"settings:codeIndex.validation.invalidQdrantUrl",
	"settings:codeIndex.validation.invalidOllamaUrl",
	"settings:codeIndex.validation.invalidBaseUrl",
]

const ALL_ERROR_KEYS = Array.from(new Set([...CASES.flatMap((c) => c.emptyErrors), ...INVALID_URL_KEYS]))

function renderFor(provider: EmbedderProvider) {
	mockExtensionState.codebaseIndexConfig = {
		codebaseIndexEnabled: true,
		codebaseIndexQdrantUrl: "",
		codebaseIndexEmbedderProvider: provider,
		codebaseIndexEmbedderModelId: "",
	}

	render(
		<CodeIndexPopover indexingStatus={indexingStatus}>
			<PopoverTrigger asChild>
				<button>open-popover</button>
			</PopoverTrigger>
		</CodeIndexPopover>,
	)

	fireEvent.click(screen.getByText("open-popover"))
	fireEvent.click(screen.getByText("settings:codeIndex.setupConfigLabel"))
}

function typeInto(placeholder: string, value: string) {
	fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } })
}

function clickSave() {
	fireEvent.click(screen.getByText("settings:codeIndex.saveSettings").closest("button")!)
}

function savedPayloads() {
	return vi
		.mocked(vscode.postMessage)
		.mock.calls.map(([message]) => message as any)
		.filter((message) => message.type === "saveCodeIndexSettingsAtomic")
		.map((message) => message.codeIndexSettings)
}

describe("CodeIndexPopover per embedder provider", () => {
	beforeEach(() => {
		vi.mocked(vscode.postMessage).mockClear()
	})

	it("covers every embedder provider", () => {
		const all: Record<EmbedderProvider, true> = {
			openai: true,
			ollama: true,
			"openai-compatible": true,
			gemini: true,
			mistral: true,
			"vercel-ai-gateway": true,
			bedrock: true,
			openrouter: true,
		}
		expect(CASES.map((c) => c.provider).sort()).toEqual(Object.keys(all).sort())
	})

	describe.each(CASES)("$provider", (testCase) => {
		it("shows only this provider's validation errors and sends nothing when required fields are empty", () => {
			renderFor(testCase.provider)

			// An invalid Qdrant URL is the one edit, so Save becomes enabled.
			typeInto("settings:codeIndex.qdrantUrlPlaceholder", "not-a-url")
			clickSave()

			expect(screen.getByText("settings:codeIndex.validation.invalidQdrantUrl")).toBeInTheDocument()
			for (const key of testCase.emptyErrors) {
				expect(screen.getByText(key)).toBeInTheDocument()
			}
			for (const key of ALL_ERROR_KEYS.filter(
				(k) => !testCase.emptyErrors.includes(k) && k !== "settings:codeIndex.validation.invalidQdrantUrl",
			)) {
				expect(screen.queryByText(key)).not.toBeInTheDocument()
			}
			if (testCase.dropdownModel) {
				expect(screen.getByTestId("model-dropdown")).toHaveClass("border-red-500")
			}
			expect(savedPayloads()).toHaveLength(0)
		})

		it("sends the filled fields in the saveCodeIndexSettingsAtomic payload", () => {
			renderFor(testCase.provider)

			typeInto("settings:codeIndex.qdrantUrlPlaceholder", QDRANT_URL)
			for (const input of testCase.inputs) {
				typeInto(input.placeholder, input.value)
			}
			if (testCase.dropdownModel) {
				fireEvent.change(screen.getByTestId("model-dropdown"), {
					target: { value: testCase.dropdownModel },
				})
			}
			clickSave()

			expect(screen.queryByText(/settings:codeIndex\.validation\./)).not.toBeInTheDocument()
			const payloads = savedPayloads()
			expect(payloads).toHaveLength(1)
			expect(payloads[0]).toEqual(
				expect.objectContaining({
					codebaseIndexEnabled: true,
					codebaseIndexEmbedderProvider: testCase.provider,
					codebaseIndexQdrantUrl: QDRANT_URL,
					...testCase.payload,
				}),
			)
		})

		if (testCase.secretField) {
			it("treats a stored API key as valid and does not send it back", () => {
				renderFor(testCase.provider)

				act(() => {
					window.dispatchEvent(
						new MessageEvent("message", {
							data: { type: "codeIndexSecretStatus", values: { [testCase.secretFlag!]: true } },
						}),
					)
				})

				typeInto("settings:codeIndex.qdrantUrlPlaceholder", QDRANT_URL)
				for (const input of testCase.inputs) {
					if (testCase.payload[testCase.secretField!] === input.value) continue
					typeInto(input.placeholder, input.value)
				}
				if (testCase.dropdownModel) {
					fireEvent.change(screen.getByTestId("model-dropdown"), {
						target: { value: testCase.dropdownModel },
					})
				}
				clickSave()

				expect(screen.queryByText(/settings:codeIndex\.validation\./)).not.toBeInTheDocument()
				const payloads = savedPayloads()
				expect(payloads).toHaveLength(1)
				expect(payloads[0]).not.toHaveProperty(testCase.secretField!)
				const { [testCase.secretField!]: _secret, ...rest } = testCase.payload
				expect(payloads[0]).toEqual(expect.objectContaining(rest))
			})
		}
	})

	describe("URL fields", () => {
		it("shows the Qdrant URL required message, not the invalid one, when the Qdrant URL is empty", () => {
			renderFor("openai")

			// Any edit enables Save; the Qdrant URL stays empty.
			typeInto("settings:codeIndex.openAiKeyPlaceholder", "sk-openai")
			clickSave()

			expect(screen.getByText("settings:codeIndex.validation.qdrantUrlRequired")).toBeInTheDocument()
			expect(screen.queryByText("settings:codeIndex.validation.invalidQdrantUrl")).not.toBeInTheDocument()
			expect(savedPayloads()).toHaveLength(0)
		})

		it.each([
			{
				provider: "ollama" as const,
				placeholder: "settings:codeIndex.ollamaUrlPlaceholder",
				invalid: "settings:codeIndex.validation.invalidOllamaUrl",
				required: "settings:codeIndex.validation.ollamaBaseUrlRequired",
			},
			{
				provider: "openai-compatible" as const,
				placeholder: "settings:codeIndex.openAiCompatibleBaseUrlPlaceholder",
				invalid: "settings:codeIndex.validation.invalidBaseUrl",
				required: "settings:codeIndex.validation.baseUrlRequired",
			},
		])("$provider: a non-empty malformed base URL still shows the invalid message", (urlCase) => {
			renderFor(urlCase.provider)

			typeInto("settings:codeIndex.qdrantUrlPlaceholder", QDRANT_URL)
			typeInto(urlCase.placeholder, "not-a-url")
			clickSave()

			expect(screen.getByText(urlCase.invalid)).toBeInTheDocument()
			expect(screen.queryByText(urlCase.required)).not.toBeInTheDocument()
			expect(savedPayloads()).toHaveLength(0)
		})
	})
})
