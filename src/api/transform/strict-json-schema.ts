/**
 * Options for {@link toStrictSchema}.
 */
export interface StrictSchemaOptions {
	/**
	 * Remove "null" from union types (["string", "null"] becomes "string", a
	 * nullable object or array is then processed like a plain one). The Chat
	 * Completions providers (BaseProvider) do this; the Responses API handlers
	 * (openai-native, openai-codex) do not.
	 */
	stripNull?: boolean
	/**
	 * MCP server schema: only add additionalProperties: false to every object
	 * schema. The server's own required list and property types are kept,
	 * because MCP tools are sent with strict: false and their optional
	 * parameters must stay optional. stripNull is ignored in this mode.
	 */
	mcp?: boolean
}

/**
 * Converts a tool parameter JSON schema to the shape OpenAI's strict mode
 * expects:
 * - every object schema gets additionalProperties: false,
 * - every property of an object schema is listed in required (not for MCP),
 * - with stripNull, "null" is removed from union types,
 * - nested objects and arrays of objects are processed recursively.
 *
 * Pure: the input is never written to. The native tool definitions are shared
 * module-level objects, so a mutation here would leak into every later request
 * of every provider (DEF-C10). Only the objects that change are copied, and key
 * order is kept, because the schema bytes are part of the cached prompt prefix.
 */
export function toStrictSchema(schema: any, options: StrictSchemaOptions = {}): any {
	if (!schema || typeof schema !== "object" || schema.type !== "object") {
		return schema
	}

	const mcp = options.mcp === true
	const stripNull = options.stripNull === true && !mcp

	const result = { ...schema }

	// OpenAI Responses API requires additionalProperties: false on all object schemas.
	// Only set it when it is not already false, so an existing key keeps its position.
	if (result.additionalProperties !== false) {
		result.additionalProperties = false
	}

	if (result.properties) {
		const allKeys = Object.keys(result.properties)
		if (!mcp) {
			// Strict mode requires ALL properties to be in the required array.
			result.required = allKeys
		}

		const newProps = { ...result.properties }
		for (const key of allKeys) {
			let prop = newProps[key]

			if (stripNull && prop && Array.isArray(prop.type) && prop.type.includes("null")) {
				const nonNullTypes = prop.type.filter((t: string) => t !== "null")
				prop = { ...prop, type: nonNullTypes.length === 1 ? nonNullTypes[0] : nonNullTypes }
				newProps[key] = prop
			}

			if (prop && prop.type === "object") {
				newProps[key] = toStrictSchema(prop, options)
			} else if (prop && prop.type === "array" && prop.items?.type === "object") {
				newProps[key] = { ...prop, items: toStrictSchema(prop.items, options) }
			}
		}
		result.properties = newProps
	}

	return result
}
