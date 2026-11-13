import "@testing-library/jest-dom/vitest"

// Force React into development mode for tests
// This is needed to enable act(...) function in React Testing Library
globalThis.process = globalThis.process || {}
globalThis.process.env = globalThis.process.env || {}
globalThis.process.env.NODE_ENV = "development"

class MockResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

global.ResizeObserver = MockResizeObserver

Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: vi.fn().mockImplementation((query) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
})

// Mock scrollIntoView which is not available in jsdom
Element.prototype.scrollIntoView = vi.fn()

// jsdom's Blob lacks stream(); Shiki 4.6 pipes its gzipped oniguruma wasm
// through Blob.stream() + DecompressionStream, so without this the highlighter
// never initializes and every render falls back to unhighlighted text.
if (typeof Blob.prototype.stream !== "function") {
	Blob.prototype.stream = function (this: Blob) {
		return new ReadableStream({
			start: async (controller) => {
				controller.enqueue(new Uint8Array(await this.arrayBuffer()))
				controller.close()
			},
		})
	}
}
