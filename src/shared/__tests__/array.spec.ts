// npx vitest run shared/__tests__/array.spec.ts

import { findLast, findLastIndex } from "../array"

describe("findLastIndex", () => {
	it("returns the index of the last element that matches", () => {
		expect(findLastIndex([1, 2, 3, 2, 1], (value) => value === 2)).toBe(3)
	})

	it("returns -1 when nothing matches or the array is empty", () => {
		expect(findLastIndex([1, 2, 3], (value) => value === 4)).toBe(-1)
		expect(findLastIndex([], () => true)).toBe(-1)
	})

	it("walks from the end and stops at the first match", () => {
		const visited: number[] = []

		findLastIndex(["a", "b", "c", "d"], (_value, index) => {
			visited.push(index)
			return index === 2
		})

		expect(visited).toEqual([3, 2])
	})

	it("passes the value, its index and the array to the predicate", () => {
		const array = ["x", "y"]
		const calls: Array<[string, number, string[]]> = []

		findLastIndex(array, (value, index, obj) => {
			calls.push([value, index, obj])
			return false
		})

		expect(calls).toEqual([
			["y", 1, array],
			["x", 0, array],
		])
		expect(calls[0][2]).toBe(array)
	})
})

describe("findLast", () => {
	it("returns the last element that matches", () => {
		const items = [
			{ id: 1, kind: "a" },
			{ id: 2, kind: "b" },
			{ id: 3, kind: "a" },
		]

		expect(findLast(items, (item) => item.kind === "a")).toBe(items[2])
	})

	it("returns undefined when nothing matches", () => {
		expect(findLast([1, 2, 3], (value) => value > 3)).toBeUndefined()
	})

	it("returns a falsy element that matches instead of undefined", () => {
		expect(findLast([1, 0, 2], (value) => value === 0)).toBe(0)
	})
})
