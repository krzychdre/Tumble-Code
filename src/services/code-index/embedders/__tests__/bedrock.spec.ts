// BedrockEmbedder's own mapping: the client it builds, the request body and the response field of
// each model family, and the AWS errors it names during validation. The Bedrock runtime client and
// the credential providers are the boundary; batching and retry are BaseHttpEmbedder's and run for
// every embedder in embedder-contract.spec.ts (including Bedrock's ThrottlingException).

const send = vi.hoisted(() => vi.fn())

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
	BedrockRuntimeClient: vi.fn(function () {
		return { send }
	}),
	InvokeModelCommand: vi.fn(function (input: unknown) {
		return { input }
	}),
}))

vi.mock("@aws-sdk/credential-providers", () => ({
	fromIni: vi.fn(() => "ini-credentials"),
	fromNodeProviderChain: vi.fn(() => "chain-credentials"),
}))

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { captureEvent: vi.fn() } },
}))

vi.mock("../../../../i18n", () => ({
	t: (key: string, params?: Record<string, unknown>) => (params?.model ? `${key} | ${String(params.model)}` : key),
}))

import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime"
import { fromIni } from "@aws-sdk/credential-providers"

import { BedrockEmbedder } from "../bedrock"
import { resetRateLimitGates } from "../rate-limit-gate"
import { Package } from "../../../../shared/package"
import { logger } from "../../../../utils/logging"

const reply = (body: unknown) => ({ body: new TextEncoder().encode(JSON.stringify(body)) })
const awsError = (name: string) => Object.assign(new Error(`${name}: refused`), { name })

/** The JSON body of each InvokeModel request, with its model id. */
const sentRequests = () =>
	send.mock.calls.map(([command]) => ({ ...command.input, body: JSON.parse(command.input.body) }))

beforeEach(() => {
	send.mockReset()
	resetRateLimitGates()
	vi.mocked(BedrockRuntimeClient).mockClear()
	vi.spyOn(logger, "error").mockImplementation(() => {})
	vi.spyOn(logger, "warn").mockImplementation(() => {})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("BedrockEmbedder", () => {
	it("refuses an empty region", () => {
		expect(() => new BedrockEmbedder("")).toThrow("Region is required for AWS Bedrock embedder")
	})

	it.each([
		["a named profile", "dev", "ini-credentials"],
		["the default credential chain", undefined, "chain-credentials"],
	])("builds its client for the region with %s", (_, profile, credentials) => {
		new BedrockEmbedder("eu-west-1", profile)

		expect(BedrockRuntimeClient).toHaveBeenCalledWith({
			userAgentAppId: `TumbleCode#${Package.version}`,
			region: "eu-west-1",
			credentials,
		})
		if (profile) expect(fromIni).toHaveBeenCalledWith({ profile })
	})

	const nova = {
		taskType: "SINGLE_EMBEDDING",
		singleEmbeddingParams: {
			embeddingPurpose: "GENERIC_INDEX",
			embeddingDimension: 1024,
			text: { truncationMode: "END", value: "code" },
		},
	}
	it.each([
		["amazon.titan-embed-text-v2:0", { inputText: "code" }, { embedding: [1, 2], inputTextTokenCount: 5 }, 5],
		[
			"amazon.nova-2-multimodal-embeddings-v1:0",
			nova,
			{ embeddings: [{ embedding: [1, 2] }], inputTextTokenCount: 4 },
			4,
		],
		["amazon.nova-2-multimodal-embeddings-v1:0", nova, { embedding: [1, 2] }, 0],
		[
			"cohere.embed-v4:0",
			{ texts: ["code"], input_type: "search_document", embedding_types: ["float"] },
			{ embeddings: { float: [[1, 2]] } },
			0,
		],
		[
			"cohere.embed-v4:0",
			{ texts: ["code"], input_type: "search_document", embedding_types: ["float"] },
			{ embeddings: [[1, 2]] },
			0,
		],
		["cohere.embed-english-v3", { texts: ["code"], input_type: "search_document" }, { embeddings: [[1, 2]] }, 0],
		["some.future-model", { inputText: "code" }, { embedding: [1, 2], inputTextTokenCount: 2 }, 2],
	])("%s: sends %j and reads the vector from %j", async (model, requestBody, responseBody, tokens) => {
		send.mockResolvedValue(reply(responseBody))

		const result = await new BedrockEmbedder("us-east-1", undefined, model).createEmbeddings(["code"])

		expect(sentRequests()).toEqual([
			{ modelId: model, body: requestBody, contentType: "application/json", accept: "application/json" },
		])
		expect(result).toEqual({ embeddings: [[1, 2]], usage: { promptTokens: tokens, totalTokens: tokens } })
	})

	it("sends one request per text, in order, and adds up the token counts", async () => {
		send.mockImplementation(async (command: { input: { body: string } }) => {
			const text = JSON.parse(command.input.body).inputText as string
			return reply({ embedding: [text.length], inputTextTokenCount: text.length })
		})

		const result = await new BedrockEmbedder("us-east-1").createEmbeddings(
			["a", "bb", "ccc"],
			"amazon.titan-embed-text-v1",
		)

		expect(sentRequests().map((r) => [r.modelId, r.body.inputText])).toEqual([
			["amazon.titan-embed-text-v1", "a"],
			["amazon.titan-embed-text-v1", "bb"],
			["amazon.titan-embed-text-v1", "ccc"],
		])
		expect(result).toEqual({ embeddings: [[1], [2], [3]], usage: { promptTokens: 6, totalTokens: 6 } })
	})

	it.each([
		["UnrecognizedClientException", "embeddings:bedrock.invalidCredentials"],
		["AccessDeniedException", "embeddings:bedrock.accessDenied"],
		["ResourceNotFoundException", "embeddings:bedrock.modelNotFound | amazon.titan-embed-text-v2:0"],
	])("validation names %s", async (name, error) => {
		send.mockRejectedValue(awsError(name))

		await expect(
			new BedrockEmbedder("us-east-1", undefined, "amazon.titan-embed-text-v2:0").validateConfiguration(),
		).resolves.toEqual({ valid: false, error })
	})

	it("validation leaves any other AWS error to the standard handling", async () => {
		send.mockRejectedValue(awsError("ValidationException"))

		await expect(new BedrockEmbedder("us-east-1").validateConfiguration()).resolves.toEqual({
			valid: false,
			error: "ValidationException: refused",
		})
	})

	it("validation of an answer without a vector names Bedrock's message", async () => {
		send.mockResolvedValue(reply({}))

		await expect(new BedrockEmbedder("us-east-1").validateConfiguration()).resolves.toEqual({
			valid: false,
			error: "embeddings:bedrock.invalidResponseFormat",
		})
	})
})
