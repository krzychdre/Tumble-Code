import { type SerializedCustomToolDefinition, parametersSchema } from "@roo-code/types"

import type { StoredCustomTool } from "./types.js"

/**
 * A tool bundled against another zod copy (an older `@roo-code/types` in the tool's own
 * node_modules, or a bundle cached before a zod upgrade) keeps its `.describe()` text in that
 * copy's metadata registry, which this copy's `toJSONSchema` cannot see: zod 3.25's `zod/v4`
 * does not share its registry across copies. Without this the model would get the parameters
 * without their descriptions. The schema's own `description` getter still reads the right
 * registry, so copy the text over when the generated schema lacks it.
 */
function keepForeignDescription(ctx: { zodSchema: unknown; jsonSchema: { description?: string } }): void {
	const description = (ctx.zodSchema as { description?: unknown }).description
	if (ctx.jsonSchema.description === undefined && typeof description === "string") {
		ctx.jsonSchema.description = description
	}
}

export function serializeCustomTool({
	name,
	description,
	parameters,
	source,
}: StoredCustomTool): SerializedCustomToolDefinition {
	return {
		name,
		description,
		parameters: parameters
			? parametersSchema.toJSONSchema(parameters, { override: keepForeignDescription })
			: undefined,
		source,
	}
}

export function serializeCustomTools(tools: StoredCustomTool[]): SerializedCustomToolDefinition[] {
	return tools.map(serializeCustomTool)
}
