import {
	addLineNumbers,
	everyLineHasLineNumbers,
	stripLineNumbers,
	truncateOutput,
	applyRunLengthEncoding,
} from "../extract-text"

describe("addLineNumbers", () => {
	it("should add line numbers starting from 1 by default", () => {
		const input = "line 1\nline 2\nline 3"
		const expected = "1 | line 1\n2 | line 2\n3 | line 3\n"
		expect(addLineNumbers(input)).toBe(expected)
	})

	it("should add line numbers starting from specified line number", () => {
		const input = "line 1\nline 2\nline 3"
		const expected = "10 | line 1\n11 | line 2\n12 | line 3\n"
		expect(addLineNumbers(input, 10)).toBe(expected)
	})

	it("should handle empty content", () => {
		expect(addLineNumbers("")).toBe("")
		expect(addLineNumbers("", 5)).toBe("5 | \n")
	})

	it("should handle single line content", () => {
		expect(addLineNumbers("single line")).toBe("1 | single line\n")
		expect(addLineNumbers("single line", 42)).toBe("42 | single line\n")
	})

	it("should pad line numbers based on the highest line number", () => {
		const input = "line 1\nline 2"
		// When starting from 99, highest line will be 100, so needs 3 spaces padding
		const expected = " 99 | line 1\n100 | line 2\n"
		expect(addLineNumbers(input, 99)).toBe(expected)
	})

	it("should preserve trailing newline without adding extra line numbers", () => {
		const input = "line 1\nline 2\n"
		const expected = "1 | line 1\n2 | line 2\n"
		expect(addLineNumbers(input)).toBe(expected)
	})

	it("should handle multiple blank lines correctly", () => {
		const input = "line 1\n\n\n\nline 2"
		const expected = "1 | line 1\n2 | \n3 | \n4 | \n5 | line 2\n"
		expect(addLineNumbers(input)).toBe(expected)
	})

	it("should handle multiple trailing newlines correctly", () => {
		const input = "line 1\nline 2\n\n\n"
		const expected = "1 | line 1\n2 | line 2\n3 | \n4 | \n"
		expect(addLineNumbers(input)).toBe(expected)
	})

	it("should handle numbered trailing newline correctly", () => {
		const input = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\n\n"
		const expected =
			" 1 | Line 1\n 2 | Line 2\n 3 | Line 3\n 4 | Line 4\n 5 | Line 5\n 6 | Line 6\n 7 | Line 7\n 8 | Line 8\n 9 | Line 9\n10 | Line 10\n11 | \n"
		expect(addLineNumbers(input)).toBe(expected)
	})

	it("should handle only blank lines with offset correctly", () => {
		const input = "\n\n\n"
		const expected = "10 | \n11 | \n12 | \n"
		expect(addLineNumbers(input, 10)).toBe(expected)
	})
})

describe("everyLineHasLineNumbers", () => {
	it("should return true for content with line numbers", () => {
		const input = "1 | line one\n2 | line two\n3 | line three"
		expect(everyLineHasLineNumbers(input)).toBe(true)
	})

	it("should return true for content with padded line numbers", () => {
		const input = "  1 | line one\n  2 | line two\n  3 | line three"
		expect(everyLineHasLineNumbers(input)).toBe(true)
	})

	it("should return false for content without line numbers", () => {
		const input = "line one\nline two\nline three"
		expect(everyLineHasLineNumbers(input)).toBe(false)
	})

	it("should return false for mixed content", () => {
		const input = "1 | line one\nline two\n3 | line three"
		expect(everyLineHasLineNumbers(input)).toBe(false)
	})

	it("should handle empty content", () => {
		expect(everyLineHasLineNumbers("")).toBe(false)
	})

	it("should return false for content with pipe but no line numbers", () => {
		const input = "a | b\nc | d"
		expect(everyLineHasLineNumbers(input)).toBe(false)
	})
})

describe("stripLineNumbers", () => {
	it("should strip line numbers from content", () => {
		const input = "1 | line one\n2 | line two\n3 | line three"
		const expected = "line one\nline two\nline three"
		expect(stripLineNumbers(input)).toBe(expected)
	})

	it("should strip padded line numbers", () => {
		const input = "  1 | line one\n  2 | line two\n  3 | line three"
		const expected = "line one\nline two\nline three"
		expect(stripLineNumbers(input)).toBe(expected)
	})

	it("should handle content without line numbers", () => {
		const input = "line one\nline two\nline three"
		expect(stripLineNumbers(input)).toBe(input)
	})

	it("should handle empty content", () => {
		expect(stripLineNumbers("")).toBe("")
	})

	it("should preserve content with pipe but no line numbers", () => {
		const input = "a | b\nc | d"
		expect(stripLineNumbers(input)).toBe(input)
	})

	it("should handle windows-style line endings", () => {
		const input = "1 | line one\r\n2 | line two\r\n3 | line three"
		const expected = "line one\r\nline two\r\nline three"
		expect(stripLineNumbers(input)).toBe(expected)
	})

	it("should handle content with varying line number widths", () => {
		const input = "  1 | line one\n 10 | line two\n100 | line three"
		const expected = "line one\nline two\nline three"
		expect(stripLineNumbers(input)).toBe(expected)
	})

	describe("aggressive mode", () => {
		it("should strip content with just a pipe character", () => {
			const input = "| line one\n| line two\n| line three"
			const expected = "line one\nline two\nline three"
			expect(stripLineNumbers(input, true)).toBe(expected)
		})

		it("should strip content with mixed formats in aggressive mode", () => {
			const input = "1 | line one\n| line two\n123 | line three"
			const expected = "line one\nline two\nline three"
			expect(stripLineNumbers(input, true)).toBe(expected)
		})

		it("should not strip content with pipe characters not at start in aggressive mode", () => {
			const input = "text | more text\nx | y"
			expect(stripLineNumbers(input, true)).toBe(input)
		})

		it("should handle empty content in aggressive mode", () => {
			expect(stripLineNumbers("", true)).toBe("")
		})

		it("should preserve padding after pipe in aggressive mode", () => {
			const input = "|  line with extra spaces\n1 |  indented content"
			const expected = " line with extra spaces\n indented content"
			expect(stripLineNumbers(input, true)).toBe(expected)
		})

		it("should preserve windows-style line endings in aggressive mode", () => {
			const input = "| line one\r\n| line two\r\n| line three"
			const expected = "line one\r\nline two\r\nline three"
			expect(stripLineNumbers(input, true)).toBe(expected)
		})

		it("should not affect regular content when using aggressive mode", () => {
			const input = "regular line\nanother line\nno pipes here"
			expect(stripLineNumbers(input, true)).toBe(input)
		})
	})
})

describe("truncateOutput", () => {
	it("returns original content when no line limit provided", () => {
		const content = "line1\nline2\nline3"
		expect(truncateOutput(content)).toBe(content)
	})

	it("returns original content when lines are under limit", () => {
		const content = "line1\nline2\nline3"
		expect(truncateOutput(content, 5)).toBe(content)
	})

	it("truncates content with 20/80 split when over limit", () => {
		// Create 25 lines of content
		const lines = Array.from({ length: 25 }, (_, i) => `line${i + 1}`)
		const content = lines.join("\n")

		// Set limit to 10 lines
		const result = truncateOutput(content, 10)

		// Should keep:
		// - First 2 lines (20% of 10)
		// - Last 8 lines (80% of 10)
		// - Omission indicator in between
		const expectedLines = [
			"line1",
			"line2",
			"",
			"[...15 lines omitted...]",
			"",
			"line18",
			"line19",
			"line20",
			"line21",
			"line22",
			"line23",
			"line24",
			"line25",
		]
		expect(result).toBe(expectedLines.join("\n"))
	})

	it("handles empty content", () => {
		expect(truncateOutput("", 10)).toBe("")
	})

	it("handles single line content", () => {
		expect(truncateOutput("single line", 10)).toBe("single line")
	})

	describe("character limit functionality", () => {
		it("returns original content when no character limit provided", () => {
			const content = "a".repeat(1000)
			expect(truncateOutput(content, undefined, undefined)).toBe(content)
		})

		it("returns original content when characters are under limit", () => {
			const content = "a".repeat(100)
			expect(truncateOutput(content, undefined, 200)).toBe(content)
		})

		it("truncates content by character limit with 20/80 split", () => {
			// Create content with 1000 characters
			const content = "a".repeat(1000)

			// Set character limit to 100
			const result = truncateOutput(content, undefined, 100)

			// Should keep:
			// - First 20 characters (20% of 100)
			// - Last 80 characters (80% of 100)
			// - Omission indicator in between
			const expectedStart = "a".repeat(20)
			const expectedEnd = "a".repeat(80)
			const expected = expectedStart + "\n[...900 characters omitted...]\n" + expectedEnd

			expect(result).toBe(expected)
		})

		it("prioritizes character limit over line limit", () => {
			// Create content with few lines but many characters per line
			const longLine = "a".repeat(500)
			const content = `${longLine}\n${longLine}\n${longLine}`

			// Set both limits - character limit should take precedence
			const result = truncateOutput(content, 10, 100)

			// Should truncate by character limit, not line limit
			const expectedStart = "a".repeat(20)
			const expectedEnd = "a".repeat(80)
			// Total content: 1502 chars, limit: 100, so 1402 chars omitted
			const expected = expectedStart + "\n[...1402 characters omitted...]\n" + expectedEnd

			expect(result).toBe(expected)
		})

		it("falls back to line limit when character limit is satisfied", () => {
			// Create content with many short lines
			const lines = Array.from({ length: 25 }, (_, i) => `line${i + 1}`)
			const content = lines.join("\n")

			// Character limit is high enough, so line limit should apply
			const result = truncateOutput(content, 10, 10000)

			// Should truncate by line limit
			const expectedLines = [
				"line1",
				"line2",
				"",
				"[...15 lines omitted...]",
				"",
				"line18",
				"line19",
				"line20",
				"line21",
				"line22",
				"line23",
				"line24",
				"line25",
			]
			expect(result).toBe(expectedLines.join("\n"))
		})

		it("handles edge case where character limit equals content length", () => {
			const content = "exactly100chars".repeat(6) + "1234" // exactly 100 chars
			const result = truncateOutput(content, undefined, 100)
			expect(result).toBe(content)
		})

		it("handles very small character limits", () => {
			const content = "a".repeat(1000)
			const result = truncateOutput(content, undefined, 10)

			// 20% of 10 = 2, 80% of 10 = 8
			const expected = "aa\n[...990 characters omitted...]\n" + "a".repeat(8)
			expect(result).toBe(expected)
		})

		it("handles character limit with mixed content", () => {
			const content = "Hello world! This is a test with mixed content including numbers 123 and symbols @#$%"
			const result = truncateOutput(content, undefined, 50)

			// 20% of 50 = 10, 80% of 50 = 40
			const expectedStart = content.slice(0, 10) // "Hello worl"
			const expectedEnd = content.slice(-40) // last 40 chars
			const omittedChars = content.length - 50
			const expected = expectedStart + `\n[...${omittedChars} characters omitted...]\n` + expectedEnd

			expect(result).toBe(expected)
		})

		describe("edge cases with very small character limits", () => {
			it("handles character limit of 1", () => {
				const content = "abcdefghijklmnopqrstuvwxyz"
				const result = truncateOutput(content, undefined, 1)

				// 20% of 1 = 0.2 (floor = 0), so beforeLimit = 0
				// afterLimit = 1 - 0 = 1
				// Should keep 0 chars from start and 1 char from end
				const expected = "\n[...25 characters omitted...]\nz"
				expect(result).toBe(expected)
			})

			it("handles character limit of 2", () => {
				const content = "abcdefghijklmnopqrstuvwxyz"
				const result = truncateOutput(content, undefined, 2)

				// 20% of 2 = 0.4 (floor = 0), so beforeLimit = 0
				// afterLimit = 2 - 0 = 2
				// Should keep 0 chars from start and 2 chars from end
				const expected = "\n[...24 characters omitted...]\nyz"
				expect(result).toBe(expected)
			})

			it("handles character limit of 5", () => {
				const content = "abcdefghijklmnopqrstuvwxyz"
				const result = truncateOutput(content, undefined, 5)

				// 20% of 5 = 1, so beforeLimit = 1
				// afterLimit = 5 - 1 = 4
				// Should keep 1 char from start and 4 chars from end
				const expected = "a\n[...21 characters omitted...]\nwxyz"
				expect(result).toBe(expected)
			})

			it("handles character limit with multi-byte characters", () => {
				const content = "🚀🎉🔥💻🌟🎨🎯🎪🎭🎬" // 10 emojis, each is multi-byte
				const result = truncateOutput(content, undefined, 10)

				// Character limit works on string length, not byte count
				// 20% of 10 = 2, 80% of 10 = 8
				// Note: In JavaScript, each emoji is actually 2 characters (surrogate pair)
				// So the content is actually 20 characters long, not 10
				const expected = "🚀\n[...10 characters omitted...]\n🎯🎪🎭🎬"
				expect(result).toBe(expected)
			})

			it("handles character limit with newlines in content", () => {
				const content = "line1\nline2\nline3\nline4\nline5"
				const result = truncateOutput(content, undefined, 15)

				// Total length is 29 chars (including newlines)
				// 20% of 15 = 3, 80% of 15 = 12
				// The slice will take first 3 chars: "lin"
				// And last 12 chars: "e4\nline5" (counting backwards)
				const expected = "lin\n[...14 characters omitted...]\n\nline4\nline5"
				expect(result).toBe(expected)
			})

			it("handles character limit exactly matching content with omission message", () => {
				// Edge case: when the omission message would make output longer than original
				const content = "short"
				const result = truncateOutput(content, undefined, 10)

				// Content is 5 chars, limit is 10, so no truncation needed
				expect(result).toBe(content)
			})

			it("handles character limit smaller than omission message", () => {
				const content = "a".repeat(100)
				const result = truncateOutput(content, undefined, 3)

				// 20% of 3 = 0.6 (floor = 0), so beforeLimit = 0
				// afterLimit = 3 - 0 = 3
				const expected = "\n[...97 characters omitted...]\naaa"
				expect(result).toBe(expected)
			})

			it("prioritizes character limit even with very high line limit", () => {
				const content = "a".repeat(1000)
				const result = truncateOutput(content, 999999, 50)

				// Character limit should still apply despite high line limit
				const expectedStart = "a".repeat(10) // 20% of 50
				const expectedEnd = "a".repeat(40) // 80% of 50
				const expected = expectedStart + "\n[...950 characters omitted...]\n" + expectedEnd
				expect(result).toBe(expected)
			})
		})
	})
})

describe("applyRunLengthEncoding", () => {
	it("should handle empty input", () => {
		expect(applyRunLengthEncoding("")).toBe("")
		expect(applyRunLengthEncoding(null as any)).toBe(null as any)
		expect(applyRunLengthEncoding(undefined as any)).toBe(undefined as any)
	})

	it("should compress repeated single lines when beneficial", () => {
		const input = "longerline\nlongerline\nlongerline\nlongerline\nlongerline\nlongerline\n"
		const expected = "longerline\n<previous line repeated 5 additional times>\n"
		expect(applyRunLengthEncoding(input)).toBe(expected)
	})

	it("should not compress when not beneficial", () => {
		const input = "y\ny\ny\ny\ny\n"
		expect(applyRunLengthEncoding(input)).toBe(input)
	})
})
