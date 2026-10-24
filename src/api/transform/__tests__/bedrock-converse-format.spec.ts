// cd src && ./node_modules/.bin/vitest run api/transform/__tests__/bedrock-converse-format.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { convertToBedrockConverseMessages } from "../bedrock-converse-format"
import { sanitizeOpenAiCallId } from "../../../utils/tool-id"

function convertBlocks(role: "user" | "assistant", blocks: unknown[]) {
	const [message] = convertToBedrockConverseMessages([
		{ role, content: blocks as Anthropic.Messages.ContentBlockParam[] },
	])
	return message.content
}

const longId = "toolu_" + "a".repeat(100)

describe("convertToBedrockConverseMessages", () => {
	it("maps roles and wraps string content in a text block", () => {
		expect(
			convertToBedrockConverseMessages([
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there" },
			]),
		).toEqual([
			{ role: "user", content: [{ text: "Hello" }] },
			{ role: "assistant", content: [{ text: "Hi there" }] },
		])
	})

	it("decodes a base64 image into bytes with the format taken from the media type", () => {
		const [text, image] = convertBlocks("user", [
			{ type: "text", text: "Look:" },
			{ type: "image", source: { type: "base64", data: "SGVsbG8=", media_type: "image/png" } },
		])!
		expect(text).toEqual({ text: "Look:" })
		expect(image).toEqual({ image: { format: "png", source: { bytes: new TextEncoder().encode("Hello") } } })
	})

	it("passes image bytes through unchanged", () => {
		const bytes = new Uint8Array([1, 2, 3])
		const [image] = convertBlocks("user", [
			{ type: "image", source: { type: "base64", data: bytes, media_type: "image/webp" } },
		])!
		expect(image).toEqual({ image: { format: "webp", source: { bytes } } })
	})

	it("rejects an image format Bedrock does not accept", () => {
		expect(() =>
			convertBlocks("user", [
				{ type: "image", source: { type: "base64", data: "SGVsbG8=", media_type: "image/tiff" } },
			]),
		).toThrow("Unsupported image format: tiff")
	})

	it("keeps tool_use input as an object and sanitizes the id", () => {
		expect(
			convertBlocks("assistant", [{ type: "tool_use", id: longId, name: "read_file", input: { path: "a.ts" } }]),
		).toEqual([
			{ toolUse: { toolUseId: sanitizeOpenAiCallId(longId), name: "read_file", input: { path: "a.ts" } } },
		])
	})

	it.each([
		["string content", { content: "file text" }, [{ text: "file text" }]],
		[
			"array content",
			{
				content: [
					{ type: "text", text: "one" },
					{ type: "text", text: "two" },
				],
			},
			[{ text: "one" }, { text: "two" }],
		],
		["string output", { output: "legacy text" }, [{ text: "legacy text" }]],
		[
			"array output with an image",
			{ output: [{ type: "text", text: "see" }, { type: "image" }, 7] },
			[{ text: "see" }, { text: "(see following message for image)" }, { text: "7" }],
		],
		["no content", {}, [{ text: "" }]],
	])("maps a tool_result with %s", (_label, fields, content) => {
		expect(convertBlocks("user", [{ type: "tool_result", tool_use_id: longId, ...fields }])).toEqual([
			{ toolResult: { toolUseId: sanitizeOpenAiCallId(longId), content, status: "success" } },
		])
	})

	it("maps video from S3 or from inline source, and marks unknown blocks", () => {
		const source = { type: "base64", data: "AAAA" }
		expect(
			convertBlocks("user", [
				{ type: "video", s3Location: { uri: "s3://b/v.mp4", bucketOwner: "123" } },
				{ type: "video", source },
				{ type: "document" },
			]),
		).toEqual([
			{ video: { format: "mp4", source: { s3Location: { uri: "s3://b/v.mp4", bucketOwner: "123" } } } },
			{ video: { format: "mp4", source } },
			{ text: "[Unknown Block Type]" },
		])
	})
})
