/**
 * The `:thinking` suffix marks a "hybrid" reasoning model whose reasoning must
 * be enabled. The model id the API honors does not have this suffix.
 */
export const withoutThinkingSuffix = (id: string): string =>
	id.endsWith(":thinking") ? id.replace(":thinking", "") : id
