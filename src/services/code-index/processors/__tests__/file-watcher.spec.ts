// npx vitest services/code-index/processors/__tests__/file-watcher.spec.ts

import * as vscode from "vscode"
import { createHash } from "crypto"
import { v5 as uuidv5 } from "uuid"

import { FileWatcher } from "../file-watcher"
import { codeParser } from "../parser"
import { QDRANT_CODE_BLOCK_NAMESPACE } from "../../constants"
import type { CodeBlock } from "../../interfaces"

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

// Mock dependencies
vi.mock("../../cache-manager")
vi.mock("../../../core/ignore/RooIgnoreController", () => ({
	RooIgnoreController: vi.fn().mockImplementation(() => ({
		validateAccess: vi.fn().mockReturnValue(true),
	})),
}))
vi.mock("ignore")
vi.mock("../parser", () => ({
	codeParser: {
		parseFile: vi.fn().mockResolvedValue([]),
	},
}))
vi.mock("../../../glob/ignore-utils", () => ({
	isPathInIgnoredDirectory: vi.fn().mockReturnValue(false),
}))

// Mock vscode module
vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn(),
		workspaceFolders: [
			{
				uri: {
					fsPath: "/mock/workspace",
				},
			},
		],
		fs: {
			stat: vi.fn().mockResolvedValue({ size: 1000 }),
			readFile: vi.fn().mockResolvedValue(Buffer.from("test content")),
		},
	},
	RelativePattern: vi.fn().mockImplementation((base, pattern) => ({ base, pattern })),
	Uri: {
		file: vi.fn().mockImplementation((path) => ({ fsPath: path })),
	},
	EventEmitter: vi.fn().mockImplementation(() => ({
		event: vi.fn(),
		fire: vi.fn(),
		dispose: vi.fn(),
	})),
	ExtensionContext: vi.fn(),
}))

describe("FileWatcher", () => {
	let fileWatcher: FileWatcher
	let mockWatcher: any
	let mockOnDidCreate: any
	let mockOnDidChange: any
	let mockOnDidDelete: any
	let mockContext: any
	let mockCacheManager: any
	let mockEmbedder: any
	let mockVectorStore: any
	let mockIgnoreInstance: any

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

		// Create mock event handlers
		mockOnDidCreate = vi.fn()
		mockOnDidChange = vi.fn()
		mockOnDidDelete = vi.fn()

		// Create mock watcher
		mockWatcher = {
			onDidCreate: vi.fn().mockImplementation((handler) => {
				mockOnDidCreate = handler
				return { dispose: vi.fn() }
			}),
			onDidChange: vi.fn().mockImplementation((handler) => {
				mockOnDidChange = handler
				return { dispose: vi.fn() }
			}),
			onDidDelete: vi.fn().mockImplementation((handler) => {
				mockOnDidDelete = handler
				return { dispose: vi.fn() }
			}),
			dispose: vi.fn(),
		}

		// Mock createFileSystemWatcher to return our mock watcher
		vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(mockWatcher)

		// Create mock dependencies
		mockContext = {
			subscriptions: [],
		}

		mockCacheManager = {
			getHash: vi.fn(),
			updateHash: vi.fn(),
			deleteHash: vi.fn(),
		}

		mockEmbedder = {
			createEmbeddings: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
		}

		mockVectorStore = {
			upsertPoints: vi.fn().mockResolvedValue(undefined),
			deletePointsByFilePath: vi.fn().mockResolvedValue(undefined),
			deletePointsByMultipleFilePaths: vi.fn().mockResolvedValue(undefined),
		}

		mockIgnoreInstance = {
			ignores: vi.fn().mockReturnValue(false),
		}

		fileWatcher = new FileWatcher(
			"/mock/workspace",
			mockContext,
			mockCacheManager,
			mockEmbedder,
			mockVectorStore,
			mockIgnoreInstance,
		)
	})

	describe("file filtering", () => {
		it("should ignore files in hidden directories on create events", async () => {
			// Initialize the file watcher
			await fileWatcher.initialize()

			// Spy on the vector store to see which files are actually processed
			const processedFiles: string[] = []
			mockVectorStore.upsertPoints.mockImplementation(async (points: any[]) => {
				points.forEach((point) => {
					if (point.payload?.file_path) {
						processedFiles.push(point.payload.file_path)
					}
				})
			})

			// Simulate file creation events
			const testCases = [
				{ path: "/mock/workspace/src/file.ts", shouldProcess: true },
				{ path: "/mock/workspace/.git/config", shouldProcess: false },
				{ path: "/mock/workspace/.hidden/file.ts", shouldProcess: false },
				{ path: "/mock/workspace/src/.next/static/file.js", shouldProcess: false },
				{ path: "/mock/workspace/node_modules/package/index.js", shouldProcess: false },
				{ path: "/mock/workspace/normal/file.js", shouldProcess: true },
			]

			// Trigger file creation events
			for (const { path } of testCases) {
				await mockOnDidCreate({ fsPath: path })
			}

			// Wait for batch processing
			await new Promise((resolve) => setTimeout(resolve, 600))

			// Check that files in hidden directories were not processed
			expect(processedFiles).not.toContain("src/.next/static/file.js")
			expect(processedFiles).not.toContain(".git/config")
			expect(processedFiles).not.toContain(".hidden/file.ts")
		})

		it("should ignore files in hidden directories on change events", async () => {
			// Initialize the file watcher
			await fileWatcher.initialize()

			// Track which files are processed
			const processedFiles: string[] = []
			mockVectorStore.upsertPoints.mockImplementation(async (points: any[]) => {
				points.forEach((point) => {
					if (point.payload?.file_path) {
						processedFiles.push(point.payload.file_path)
					}
				})
			})

			// Simulate file change events
			const testCases = [
				{ path: "/mock/workspace/src/file.ts", shouldProcess: true },
				{ path: "/mock/workspace/.vscode/settings.json", shouldProcess: false },
				{ path: "/mock/workspace/src/.cache/data.json", shouldProcess: false },
				{ path: "/mock/workspace/dist/bundle.js", shouldProcess: false },
			]

			// Trigger file change events
			for (const { path } of testCases) {
				await mockOnDidChange({ fsPath: path })
			}

			// Wait for batch processing
			await new Promise((resolve) => setTimeout(resolve, 600))

			// Check that files in hidden directories were not processed
			expect(processedFiles).not.toContain(".vscode/settings.json")
			expect(processedFiles).not.toContain("src/.cache/data.json")
		})

		it("should ignore files in hidden directories on delete events", async () => {
			// Initialize the file watcher
			await fileWatcher.initialize()

			// Track which files are deleted
			const deletedFiles: string[] = []
			mockVectorStore.deletePointsByFilePath.mockImplementation(async (filePath: string) => {
				deletedFiles.push(filePath)
			})

			// Simulate file deletion events
			const testCases = [
				{ path: "/mock/workspace/src/file.ts", shouldProcess: true },
				{ path: "/mock/workspace/.git/objects/abc123", shouldProcess: false },
				{ path: "/mock/workspace/.DS_Store", shouldProcess: false },
				{ path: "/mock/workspace/build/.cache/temp.js", shouldProcess: false },
			]

			// Trigger file deletion events
			for (const { path } of testCases) {
				await mockOnDidDelete({ fsPath: path })
			}

			// Wait for batch processing
			await new Promise((resolve) => setTimeout(resolve, 600))

			// Check that files in hidden directories were not processed
			expect(deletedFiles).not.toContain(".git/objects/abc123")
			expect(deletedFiles).not.toContain(".DS_Store")
			expect(deletedFiles).not.toContain("build/.cache/temp.js")
		})

		it("should handle nested hidden directories correctly", async () => {
			// Initialize the file watcher
			await fileWatcher.initialize()

			// Track which files are processed
			const processedFiles: string[] = []
			mockVectorStore.upsertPoints.mockImplementation(async (points: any[]) => {
				points.forEach((point) => {
					if (point.payload?.file_path) {
						processedFiles.push(point.payload.file_path)
					}
				})
			})

			// Test deeply nested hidden directories
			const testCases = [
				{ path: "/mock/workspace/src/components/Button.tsx", shouldProcess: true },
				{ path: "/mock/workspace/src/.hidden/components/Button.tsx", shouldProcess: false },
				{ path: "/mock/workspace/.hidden/src/components/Button.tsx", shouldProcess: false },
				{ path: "/mock/workspace/src/components/.hidden/Button.tsx", shouldProcess: false },
			]

			// Trigger file creation events
			for (const { path } of testCases) {
				await mockOnDidCreate({ fsPath: path })
			}

			// Wait for batch processing
			await new Promise((resolve) => setTimeout(resolve, 600))

			// Check that files in hidden directories were not processed
			expect(processedFiles).not.toContain("src/.hidden/components/Button.tsx")
			expect(processedFiles).not.toContain(".hidden/src/components/Button.tsx")
			expect(processedFiles).not.toContain("src/components/.hidden/Button.tsx")
		})
	})

	describe("point ids (DEF-C17 drift 1)", () => {
		// Two segments of one long line: same file, same start_line, different content.
		const makeBlock = (overrides: Partial<CodeBlock>): CodeBlock => ({
			file_path: "/mock/workspace/src/long.ts",
			identifier: null,
			type: "chunk",
			start_line: 7,
			end_line: 7,
			content: "segment",
			fileHash: "file-hash",
			segmentHash: "segment-hash",
			...overrides,
		})

		it("derives point ids from segmentHash, the same way the directory scanner does", async () => {
			const blocks = [
				makeBlock({ content: "  first half of a long line  ", segmentHash: "hash-a" }),
				makeBlock({ content: "second half of a long line", segmentHash: "hash-b" }),
			]
			vi.mocked(codeParser.parseFile).mockResolvedValueOnce(blocks)
			mockEmbedder.createEmbeddings.mockResolvedValueOnce({
				embeddings: [
					[0.1, 0.2],
					[0.3, 0.4],
				],
			})

			const result = await fileWatcher.processFile("/mock/workspace/src/long.ts")

			expect(result.status).toBe("processed_for_batching")
			const points = result.pointsToUpsert!
			// scanner.ts: uuidv5(block.segmentHash, QDRANT_CODE_BLOCK_NAMESPACE)
			expect(points.map((p) => p.id)).toEqual([
				uuidv5("hash-a", QDRANT_CODE_BLOCK_NAMESPACE),
				uuidv5("hash-b", QDRANT_CODE_BLOCK_NAMESPACE),
			])
			// Two segments on one line must not collapse into one point.
			expect(new Set(points.map((p) => p.id)).size).toBe(2)
			expect(points.map((p) => p.payload.segmentHash)).toEqual(["hash-a", "hash-b"])
		})

		it("embeds trimmed text and skips whitespace-only blocks, like the directory scanner", async () => {
			const blocks = [
				makeBlock({ content: "  const a = 1  ", segmentHash: "hash-a" }),
				makeBlock({ content: "   \n\t ", segmentHash: "hash-blank", start_line: 9 }),
			]
			vi.mocked(codeParser.parseFile).mockResolvedValueOnce(blocks)
			mockEmbedder.createEmbeddings.mockResolvedValueOnce({ embeddings: [[0.1, 0.2]] })

			const result = await fileWatcher.processFile("/mock/workspace/src/long.ts")

			expect(mockEmbedder.createEmbeddings).toHaveBeenCalledWith(["const a = 1"])
			expect(result.pointsToUpsert!.map((p) => p.id)).toEqual([uuidv5("hash-a", QDRANT_CODE_BLOCK_NAMESPACE)])
			// The stored chunk keeps the original text, as the scanner stores block.content.
			expect(result.pointsToUpsert![0].payload.codeChunk).toBe("  const a = 1  ")
		})
	})

	describe("re-indexing a changed file (DEF-C17 drift 4)", () => {
		const filePath = "/mock/workspace/src/app.ts"
		// vscode.workspace.fs.readFile is mocked to return "test content"
		const currentHash = createHash("sha256").update("test content").digest("hex")
		const block: CodeBlock = {
			file_path: filePath,
			identifier: "main",
			type: "function",
			start_line: 1,
			end_line: 3,
			content: "test content",
			fileHash: currentHash,
			segmentHash: "seg-1",
		}

		const flushBatch = () => new Promise((resolve) => setTimeout(resolve, 600))

		beforeEach(async () => {
			await fileWatcher.initialize()
		})

		it("keeps the points of a file whose change event did not change its content", async () => {
			// Indexed before with exactly this content (e.g. saved without edits, touched, or
			// rewritten with identical text by a tool or a git checkout).
			mockCacheManager.getHash.mockReturnValue(currentHash)

			await mockOnDidChange({ fsPath: filePath })
			await flushBatch()

			expect(mockVectorStore.deletePointsByMultipleFilePaths).not.toHaveBeenCalled()
			expect(mockVectorStore.upsertPoints).not.toHaveBeenCalled()
		})

		it("deletes the old points of a changed file only when it is re-indexed, right before the upsert", async () => {
			mockCacheManager.getHash.mockReturnValue("old-hash")
			vi.mocked(codeParser.parseFile).mockResolvedValueOnce([block])

			await mockOnDidChange({ fsPath: filePath })
			await flushBatch()

			expect(mockVectorStore.deletePointsByMultipleFilePaths).toHaveBeenCalledWith([filePath])
			expect(mockVectorStore.upsertPoints).toHaveBeenCalledTimes(1)
			const deleteOrder = mockVectorStore.deletePointsByMultipleFilePaths.mock.invocationCallOrder[0]
			const upsertOrder = mockVectorStore.upsertPoints.mock.invocationCallOrder[0]
			expect(deleteOrder).toBeLessThan(upsertOrder)
			// The embedding request comes before the delete: a failing embedder leaves the old points.
			expect(mockEmbedder.createEmbeddings.mock.invocationCallOrder[0]).toBeLessThan(deleteOrder)
			expect(mockCacheManager.updateHash).toHaveBeenCalledWith(filePath, currentHash)
		})

		it("keeps the old points when embedding the changed file fails", async () => {
			mockCacheManager.getHash.mockReturnValue("old-hash")
			vi.mocked(codeParser.parseFile).mockResolvedValueOnce([block])
			mockEmbedder.createEmbeddings.mockRejectedValueOnce(new Error("connect ECONNREFUSED"))

			await mockOnDidChange({ fsPath: filePath })
			await flushBatch()

			expect(mockVectorStore.deletePointsByMultipleFilePaths).not.toHaveBeenCalled()
			expect(mockVectorStore.upsertPoints).not.toHaveBeenCalled()
		})

		it("replaces the points of an already indexed file reported by a create event, like the scanner", async () => {
			// An atomic save (write temp file, rename) or a checkout can surface as delete+create;
			// the debounce keeps only the last event. The scanner clears every file it had indexed.
			mockCacheManager.getHash.mockReturnValue("old-hash")
			vi.mocked(codeParser.parseFile).mockResolvedValueOnce([block])

			await mockOnDidCreate({ fsPath: filePath })
			await flushBatch()

			expect(mockVectorStore.deletePointsByMultipleFilePaths).toHaveBeenCalledWith([filePath])
			expect(mockVectorStore.upsertPoints).toHaveBeenCalledTimes(1)
		})

		it("does not delete anything for a brand new file", async () => {
			mockCacheManager.getHash.mockReturnValue(undefined)
			vi.mocked(codeParser.parseFile).mockResolvedValueOnce([block])

			await mockOnDidCreate({ fsPath: filePath })
			await flushBatch()

			expect(mockVectorStore.deletePointsByMultipleFilePaths).not.toHaveBeenCalled()
			expect(mockVectorStore.upsertPoints).toHaveBeenCalledTimes(1)
		})

		it("does not upsert or update the hash when deleting the old points fails", async () => {
			mockCacheManager.getHash.mockReturnValue("old-hash")
			vi.mocked(codeParser.parseFile).mockResolvedValueOnce([block])
			mockVectorStore.deletePointsByMultipleFilePaths.mockRejectedValueOnce(new Error("Qdrant down"))

			await mockOnDidChange({ fsPath: filePath })
			await flushBatch()

			expect(mockVectorStore.upsertPoints).not.toHaveBeenCalled()
			expect(mockCacheManager.updateHash).not.toHaveBeenCalled()
		})
	})

	describe("dispose", () => {
		it("should dispose of the watcher when disposed", async () => {
			await fileWatcher.initialize()
			fileWatcher.dispose()

			expect(mockWatcher.dispose).toHaveBeenCalled()
		})
	})
})
