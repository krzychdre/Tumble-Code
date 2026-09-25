import { type ModelInfo, selectVertexModel } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { getModelParams } from "../transform/model-params"

import { GeminiHandler, finishGeminiModel } from "./gemini"
import { SingleCompletionHandler } from "../index"

export class VertexHandler extends GeminiHandler implements SingleCompletionHandler {
	constructor(options: ApiHandlerOptions) {
		super({ ...options, isVertex: true })
	}

	override getModel() {
		const { id, info } = selectVertexModel(this.options)
		const params = getModelParams({
			format: "gemini",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: info.defaultTemperature ?? 1,
		})

		return { ...finishGeminiModel({ id, info }), ...params }
	}
}

/** The `{ id, info }` that `VertexHandler.getModel()` reports, without building a handler. */
export function resolveVertexModel(options: ApiHandlerOptions): { id: string; info: ModelInfo } {
	return finishGeminiModel(selectVertexModel(options))
}
