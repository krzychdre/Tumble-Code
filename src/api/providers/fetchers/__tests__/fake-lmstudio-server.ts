// A local fake LM Studio server for specs that run the REAL @lmstudio/sdk: HTTP for the
// `/v1/models` probe, WebSocket for the SDK's namespaces (`/system`, `/llm`) speaking its
// protocol (auth packet, rpcCall/rpcResult, channelCreate/channelSend).

import http from "node:http"
import type { AddressInfo } from "node:net"
import { createRequire } from "node:module"

// `ws` as the SDK itself resolves it (through @lmstudio/lms-isomorphic). `src` has no
// `ws` types, so the few members used here are typed locally.
type FakeSocket = {
	send(data: string): void
	on(event: "message", listener: (raw: Buffer) => void): void
	terminate(): void
}
type FakeSocketServer = {
	clients: Set<FakeSocket>
	on(event: "connection", listener: (socket: FakeSocket, request: http.IncomingMessage) => void): void
	close(): void
}
const sdkRequire = createRequire(require.resolve("@lmstudio/sdk"))
const { WebSocketServer } = createRequire(sdkRequire.resolve("@lmstudio/lms-isomorphic"))("ws") as {
	WebSocketServer: new (options: { server: http.Server }) => FakeSocketServer
}

export type Recorded = { path: string; message: Record<string, any> }

/** Answers one SDK message; `send` writes a JSON message back on the same socket. */
export type Responder = (message: Record<string, any>, send: (reply: unknown) => void) => void

export type FakeLmStudioServer = {
	baseUrl: string
	/** Every message the SDK sent over its sockets, in order. */
	recorded: Recorded[]
	/** Every plain HTTP request, as "METHOD /path". */
	httpRequests: string[]
	/** WebSocket connections that are still open. */
	openSockets(): number
	stop(): Promise<void>
}

export async function startFakeLmStudioServer(options: {
	respond: Responder
	/** When false, HTTP requests get no answer at all. */
	answerHttp?: boolean
}): Promise<FakeLmStudioServer> {
	const recorded: Recorded[] = []
	const httpRequests: string[] = []
	const server = http.createServer((request, response) => {
		httpRequests.push(`${request.method} ${request.url}`)
		if (options.answerHttp === false) return
		response.setHeader("content-type", "application/json")
		response.end(JSON.stringify({ object: "list", data: [] }))
	})
	const wss = new WebSocketServer({ server })
	wss.on("connection", (socket, request) => {
		socket.on("message", (raw) => {
			const message = JSON.parse(raw.toString())
			recorded.push({ path: request.url ?? "", message })
			if (message.authVersion !== undefined) {
				socket.send(JSON.stringify({ success: true }))
				return
			}
			options.respond(message, (reply) => socket.send(JSON.stringify(reply)))
		})
	})
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))

	return {
		baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
		recorded,
		httpRequests,
		openSockets: () => wss.clients.size,
		stop: async () => {
			// Upgraded (WebSocket) connections are not closed by closeAllConnections().
			wss.clients.forEach((client) => client.terminate())
			wss.close()
			server.closeAllConnections()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		},
	}
}
