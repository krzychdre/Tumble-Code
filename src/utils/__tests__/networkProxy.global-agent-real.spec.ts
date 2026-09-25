// Runs the real `global-agent` (networkProxy.spec mocks it) the way the debug
// proxy (utils/networkProxy.ts configureGlobalProxy) uses it: set the
// GLOBAL_AGENT_* variables like updateProxyEnvVars, load the module and call
// bootstrap(). It patches the process-wide http/https agents, so it runs in a
// child process against a local target server and a local proxy that records
// what it receives.
//
// Pinned: bootstrap is reachable both through require() (what the esbuild
// bundle does, global-agent is an external) and through import(); an empty
// NO_PROXY proxies even 127.0.0.1; plain HTTP is sent to the proxy in absolute
// form; HTTPS is tunnelled with CONNECT host:port.
import { spawn } from "child_process"
import http from "http"
import net from "net"
import type { AddressInfo } from "net"
import { createRequire } from "module"

import nock from "nock"

const globalAgentPath = createRequire(__filename).resolve("global-agent")

type Seen = { method: string; url: string }

function listen(server: http.Server | net.Server): Promise<number> {
	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
	)
}

// Tunnel (CONNECT) sockets are not tracked by closeAllConnections(), so every
// socket is recorded and destroyed on close.
const sockets = new Set<net.Socket>()

function track(server: http.Server): http.Server {
	server.on("connection", (socket: net.Socket) => {
		sockets.add(socket)
		socket.on("close", () => sockets.delete(socket))
	})
	return server
}

function close(server: http.Server): Promise<void> {
	return new Promise((resolve) => {
		server.close(() => resolve())
		for (const socket of sockets) socket.destroy()
	})
}

const childScript = `
const http = require("http")
const https = require("https")
const { pathToFileURL } = require("url")
const gaPath = process.env.GA_PATH
function get(mod, url) {
	return new Promise((resolve) => {
		const req = mod.get(url, (res) => {
			let body = ""
			res.on("data", (c) => (body += c))
			res.on("end", () => resolve({ status: res.statusCode, body }))
		})
		req.on("error", (e) => resolve({ error: e.code || e.message }))
		req.setTimeout(4000, () => req.destroy(new Error("timeout")))
	})
}
;(async () => {
	const viaImport = await import(pathToFileURL(gaPath).href)
	const mod = require(gaPath)
	mod.bootstrap()
	const out = {
		requireBootstrap: typeof mod.bootstrap,
		importBootstrap: typeof viaImport.bootstrap,
		globalAgent: typeof globalThis.GLOBAL_AGENT,
		http: await get(http, process.env.TARGET_HTTP),
		https: await get(https, process.env.TARGET_HTTPS),
	}
	process.stdout.write(JSON.stringify(out))
})()
`

function runChild(env: Record<string, string>): Promise<Record<string, any>> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ["-e", childScript], {
			env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ...env },
			stdio: ["ignore", "pipe", "pipe"],
		})
		let stdout = ""
		let stderr = ""
		child.stdout.on("data", (c) => (stdout += c))
		child.stderr.on("data", (c) => (stderr += c))
		child.on("error", reject)
		child.on("close", () => {
			try {
				resolve(JSON.parse(stdout))
			} catch {
				reject(new Error(`child output not JSON: ${stdout}\n${stderr}`))
			}
		})
	})
}

describe("global-agent as used by the debug proxy", () => {
	let target: http.Server
	let proxy: http.Server
	let targetPort: number
	let proxyPort: number
	const seen: Seen[] = []

	beforeAll(async () => {
		// vitest.setup.ts blocks the network; the proxy forwards to a local target.
		nock.enableNetConnect("127.0.0.1")
		target = track(http.createServer((req, res) => res.end(`target saw ${req.url}`)))
		targetPort = await listen(target)

		proxy = track(
			http.createServer((req, res) => {
				seen.push({ method: req.method ?? "", url: req.url ?? "" })
				// Forward absolute-form requests to the target.
				const upstream = http.request(req.url ?? "", { method: req.method, headers: req.headers }, (up) => {
					res.writeHead(up.statusCode ?? 502, up.headers)
					up.pipe(res)
				})
				upstream.on("error", () => res.writeHead(502).end())
				req.pipe(upstream)
			}),
		)
		// Record the tunnel request and refuse it: no TLS server is needed to pin
		// that HTTPS goes through the proxy.
		proxy.on("connect", (req, socket) => {
			seen.push({ method: req.method ?? "", url: req.url ?? "" })
			socket.end("HTTP/1.1 403 Forbidden\r\n\r\n")
		})
		proxyPort = await listen(proxy)
	})

	afterAll(async () => {
		await close(proxy)
		await close(target)
		nock.disableNetConnect()
	})

	it("routes http and https requests through the proxy after bootstrap()", async () => {
		seen.length = 0
		const proxyUrl = `http://127.0.0.1:${proxyPort}`
		const out = await runChild({
			GA_PATH: globalAgentPath,
			GLOBAL_AGENT_HTTP_PROXY: proxyUrl,
			GLOBAL_AGENT_HTTPS_PROXY: proxyUrl,
			GLOBAL_AGENT_NO_PROXY: "",
			TARGET_HTTP: `http://127.0.0.1:${targetPort}/plain?x=1`,
			TARGET_HTTPS: `https://127.0.0.1:${targetPort}/secure`,
		})

		expect(out.requireBootstrap).toBe("function")
		expect(out.importBootstrap).toBe("function")
		expect(out.globalAgent).toBe("object")

		expect(out.http).toEqual({ status: 200, body: "target saw /plain?x=1" })
		expect(seen).toContainEqual({ method: "GET", url: `http://127.0.0.1:${targetPort}/plain?x=1` })

		// The proxy refused the tunnel, so the https request fails, but it was asked for.
		expect(out.https.status).toBeUndefined()
		expect(seen).toContainEqual({ method: "CONNECT", url: `127.0.0.1:${targetPort}` })
	}, 20_000)
})
