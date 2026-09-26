import workerpool from "workerpool"

import { Anthropic } from "@anthropic-ai/sdk"

import { tiktoken, tiktokenPerBlock } from "../utils/tiktoken"

import { type CountTokensPerBlockResult, type CountTokensResult } from "./types"

async function countTokens(content: Anthropic.Messages.ContentBlockParam[]): Promise<CountTokensResult> {
	try {
		const count = await tiktoken(content)
		return { success: true, count }
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		}
	}
}

async function countTokensPerBlock(
	content: Anthropic.Messages.ContentBlockParam[],
): Promise<CountTokensPerBlockResult> {
	try {
		const counts = await tiktokenPerBlock(content)
		return { success: true, counts }
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		}
	}
}

workerpool.worker({ countTokens, countTokensPerBlock })
