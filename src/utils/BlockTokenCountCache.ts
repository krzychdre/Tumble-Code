import type { Anthropic } from "@anthropic-ai/sdk"

import { countTokensPerBlock } from "./countTokens"
import { applyTokenFudge, blockCountKeyParts, TIKTOKEN_ENCODING } from "./tiktoken"

type Block = Anthropic.Messages.ContentBlockParam

export type PerBlockCounter = (blocks: Block[]) => Promise<number[]>

/** One level of the key trie: the next key part leads to a child, a full key ends at `count`. */
type Node = { children: Map<string, Node>; count?: number }

const newNode = (): Node => ({ children: new Map() })

/**
 * Remembers the raw token count of each content block, so a request whose
 * history only grew by a few blocks tokenizes just those.
 *
 * The key is the tokenizer encoding, the caller's scope (the model id) and
 * `blockCountKeyParts(block)`: every value the local tokenizer reads from the
 * block. Equal keys therefore always mean equal counts, and an edited block
 * (even one mutated in place) gets a new key and is recounted. Object identity
 * is never used. The parts are the block's own strings, kept in a trie of
 * Maps, so a lookup costs a few hash probes on strings whose hash V8 already
 * cached: no copy, no JSON, no digest of the history on the extension host.
 *
 * The total is `applyTokenFudge(sum of raw counts)`, exactly what `tiktoken`
 * returns for the same blocks in one call.
 *
 * Memory: after each call the cache keeps only the keys of that call's blocks,
 * so it never holds more entries than the latest history has blocks (and only
 * references strings that history holds anyway); a condensed or truncated
 * history frees the dropped entries at once. One instance belongs to one
 * handler, which a mode or profile switch replaces.
 */
export class BlockTokenCountCache {
	private root: Node = newNode()
	private entries = 0

	constructor(private readonly countPerBlock: PerBlockCounter = (blocks) => countTokensPerBlock(blocks)) {}

	/** Number of remembered block counts. */
	get size(): number {
		return this.entries
	}

	async count(content: Block[], scope: string): Promise<number> {
		if (content.length === 0) {
			return 0
		}

		// Read the known counts before the await: a concurrent call may replace them.
		const known = this.root
		const keys = content.map((block) => keyOf(`${TIKTOKEN_ENCODING}\0${scope}`, block))

		// Tokenize every block whose key is unknown (once per distinct key) and
		// every block that has no key.
		const next = newNode()
		const nodes = keys.map((key) => (key === undefined ? undefined : insert(next, key)))
		const missing: Block[] = []
		const missingNodes: Array<Node | undefined> = []
		const queued = new Set<Node>()
		content.forEach((block, i) => {
			const node = nodes[i]
			if (node === undefined) {
				missing.push(block)
				missingNodes.push(undefined)
			} else if (node.count === undefined && !queued.has(node)) {
				const cached = lookup(known, keys[i]!)
				if (cached === undefined) {
					missing.push(block)
					missingNodes.push(node)
					queued.add(node)
				} else {
					node.count = cached
				}
			}
		})

		let raw = 0
		if (missing.length > 0) {
			const counted = await this.countPerBlock(missing)
			missingNodes.forEach((node, i) => {
				if (node) {
					node.count = counted[i]
				} else {
					raw += counted[i]
				}
			})
		}

		const distinct = new Set<Node>()
		for (const node of nodes) {
			if (node) {
				raw += node.count!
				distinct.add(node)
			}
		}

		this.root = next
		this.entries = distinct.size
		return applyTokenFudge(raw)
	}
}

function keyOf(scope: string, block: Block): string[] | undefined {
	try {
		return [scope, ...blockCountKeyParts(block)]
	} catch {
		// A block the tokenizer itself would fail on: never cache it, let the
		// counter handle it exactly as an uncached count would.
		return undefined
	}
}

function insert(root: Node, key: string[]): Node {
	let node = root
	for (const part of key) {
		let child = node.children.get(part)
		if (!child) {
			child = newNode()
			node.children.set(part, child)
		}
		node = child
	}
	return node
}

function lookup(root: Node, key: string[]): number | undefined {
	let node: Node | undefined = root
	for (const part of key) {
		node = node.children.get(part)
		if (!node) {
			return undefined
		}
	}
	return node.count
}
