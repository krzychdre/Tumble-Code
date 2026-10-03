/**
 * A fake Tumble Code Cloud on 127.0.0.1 for the sign-in cases: the sign-in
 * redirect to a loopback address, the Clerk-shaped auth endpoints, and
 * `/api/*` posts (recorded, answered with `{}`).
 */

import http from "http"
import type { AddressInfo } from "net"

const TICKET = "ticket-integration"
export const SESSION_ID = "sess_integration"
const CLIENT_TOKEN = "client-token-integration"
export const EMAIL = "cli-integration@example.com"

interface Recorded {
	method: string
	path: string
	body: string
}

export function startFakeCloud(): Promise<{ url: string; requests: Recorded[]; close: () => void }> {
	const requests: Recorded[] = []

	const server = http.createServer((request, response) => {
		let body = ""
		request.on("data", (chunk) => (body += chunk))
		request.on("end", () => {
			const url = new URL(request.url ?? "/", "http://127.0.0.1")
			requests.push({ method: request.method ?? "", path: url.pathname, body })

			const json = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
				response.writeHead(status, { "Content-Type": "application/json", ...headers })
				response.end(JSON.stringify(payload))
			}

			if (request.method === "GET" && url.pathname === "/extension/sign-in") {
				const redirect = url.searchParams.get("auth_redirect") ?? ""
				const state = url.searchParams.get("state") ?? ""

				if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(redirect)) {
					json(400, { error: `not a loopback redirect: ${redirect}` })
					return
				}

				response.writeHead(302, { Location: `${redirect}/auth/clerk/callback?code=${TICKET}&state=${state}` })
				response.end()
				return
			}

			if (request.method === "POST" && url.pathname === "/v1/client/sign_ins") {
				if (new URLSearchParams(body).get("ticket") !== TICKET) {
					json(400, { error: "bad ticket" })
					return
				}

				json(200, { response: { created_session_id: SESSION_ID } }, { Authorization: CLIENT_TOKEN })
				return
			}

			if (request.method === "POST" && url.pathname === `/v1/client/sessions/${SESSION_ID}/tokens`) {
				if (request.headers.authorization !== `Bearer ${CLIENT_TOKEN}`) {
					json(401, { error: "bad client token" })
					return
				}

				json(200, { jwt: "jwt-integration" })
				return
			}

			if (request.method === "GET" && url.pathname === "/v1/me") {
				json(200, {
					response: {
						id: "user_integration",
						first_name: "CLI",
						primary_email_address_id: "email_1",
						email_addresses: [{ id: "email_1", email_address: EMAIL }],
					},
				})
				return
			}

			if (url.pathname === "/v1/me/organization_memberships") {
				json(200, { response: [] })
				return
			}

			if (url.pathname === `/v1/client/sessions/${SESSION_ID}/remove`) {
				json(200, {})
				return
			}

			if (request.method === "POST" && url.pathname.startsWith("/api/")) {
				json(200, {})
				return
			}

			json(404, { error: "not found" })
		})
	})

	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo
			resolve({ url: `http://127.0.0.1:${port}`, requests, close: () => server.close() })
		})
	})
}
