import { normalizeQdrantUrl } from "../qdrant-client"

vitest.mock("../../../../i18n", () => ({ t: (key: string) => key }))

// Each row was recorded from the constructor before the URL handling moved into normalizeQdrantUrl:
// the URL shown in messages, and what the Qdrant client is given.
const host = (host: string, https: boolean, port: number, prefix?: string) => ({ host, https, port, prefix })

describe("normalizeQdrantUrl", () => {
	it.each([
		// Missing or blank: the local default.
		[undefined, "http://localhost:6333", host("localhost", false, 6333)],
		["", "http://localhost:6333", host("localhost", false, 6333)],
		["   ", "http://localhost:6333", host("localhost", false, 6333)],
		// Full URLs are kept as typed (trimmed); the port is always explicit.
		["http://localhost:6333", "http://localhost:6333", host("localhost", false, 6333)],
		["  http://localhost:6333  ", "http://localhost:6333", host("localhost", false, 6333)],
		["https://q.example.com", "https://q.example.com", host("q.example.com", true, 443)],
		["https://example.com:9000", "https://example.com:9000", host("example.com", true, 9000)],
		["http://example.com", "http://example.com", host("example.com", false, 80)],
		["HTTP://LOCALHOST:6333", "HTTP://LOCALHOST:6333", host("localhost", false, 6333)],
		["ftp://files.example.com", "ftp://files.example.com", host("files.example.com", false, 80)],
		["http://[::1]:6333", "http://[::1]:6333", host("[::1]", false, 6333)],
		// Path becomes the prefix without trailing slashes; query and fragment are ignored.
		["http://localhost:6333/", "http://localhost:6333/", host("localhost", false, 6333)],
		["http://localhost:6333/api///", "http://localhost:6333/api///", host("localhost", false, 6333, "/api")],
		[
			"https://example.com/api/v1?key=value",
			"https://example.com/api/v1?key=value",
			host("example.com", true, 443, "/api/v1"),
		],
		[
			"https://example.com/ollama/api/v1///?key=value#pos",
			"https://example.com/ollama/api/v1///?key=value#pos",
			host("example.com", true, 443, "/ollama/api/v1"),
		],
		// Bare host names, IPs and host:port get http://.
		["qdrant.example.com", "http://qdrant.example.com", host("qdrant.example.com", false, 80)],
		["localhost:6333", "http://localhost:6333", host("localhost", false, 6333)],
		["192.168.1.100", "http://192.168.1.100", host("192.168.1.100", false, 80)],
		["192.168.1.100:6333", "http://192.168.1.100:6333", host("192.168.1.100", false, 6333)],
		["[::1]:6333", "http://[::1]:6333", host("[::1]", false, 6333)],
		["invalid-url-format", "http://invalid-url-format", host("invalid-url-format", false, 80)],
		["qdrant:6333/prefix", "http://qdrant:6333/prefix", host("qdrant", false, 6333, "/prefix")],
		// A host name starting with "http" plus a port is still a bare host:port, not a URL with scheme "httpbin:".
		["httpbin.org:8080", "http://httpbin.org:8080", host("httpbin.org", false, 8080)],
		["http-qdrant", "http://http-qdrant", host("http-qdrant", false, 80)],
		// Not a URL even with http:// added: the client gets the raw URL.
		["foo bar", "http://foo bar", { url: "http://foo bar" }],
		["http://", "http://", { url: "http://" }],
	])("%j", (input, url, connection) => {
		expect(normalizeQdrantUrl(input)).toStrictEqual({ url, connection })
	})
})
