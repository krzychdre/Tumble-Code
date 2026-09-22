import crypto from "crypto"
import fs from "fs/promises"
import net from "net"
import os from "os"
import path from "path"

/**
 * Lets a command ask the user for a secret without a terminal.
 *
 * A command we run has no controlling terminal (see USE_OWN_SESSION in
 * ExecaTerminalProcess), so `git`, `ssh` and `sudo` cannot prompt on /dev/tty
 * the way they normally would. All three accept a substitute: point them at a
 * program through GIT_ASKPASS / SSH_ASKPASS / SUDO_ASKPASS and they run it with
 * the question as its first argument and read the answer from its stdout.
 *
 * This class is the other end of that program. It listens on a unix socket in a
 * private directory; the helper connects, sends the question, and waits for the
 * answer that the host (the CLI's own prompt, or an input box in VS Code) gets
 * from the user.
 *
 * Nothing here ever reaches the model: the answer travels from the host back to
 * the socket and is not recorded as a message.
 */

export type AskpassHandler = (request: AskpassRequest) => Promise<string | undefined>

export interface AskpassRequest {
	/** The question as the command phrased it, e.g. `Password for 'https://git@github.com':`. */
	prompt: string
	/** The command the question came from, for context in the prompt. */
	command: string
	/**
	 * False when the answer is not a secret and should stay visible, which is
	 * the case for ssh's host key confirmation.
	 */
	isSecret: boolean
}

interface AskpassWire {
	token?: unknown
	prompt?: unknown
}

/**
 * ssh routes its host key question ("Are you sure you want to continue
 * connecting (yes/no/[fingerprint])?") through askpass as well. Masking that
 * one would leave the user typing invisible `yes`, so questions that are not
 * about a secret are recognised here and shown in the clear.
 */
function looksLikeSecret(prompt: string): boolean {
	return !/\(yes\/no|authenticity of host|continue connecting/i.test(prompt)
}

export class AskpassServer {
	private server?: net.Server
	private directory?: string
	private token = ""
	private helperPath = ""

	constructor(
		private readonly command: string,
		private readonly handler: AskpassHandler,
	) {}

	/**
	 * Creates the socket and the helper script. Returns the environment the
	 * command needs so git, ssh and sudo find them, or an empty object when the
	 * bridge could not be set up, in which case the caller's existing
	 * non-interactive settings make the command fail fast instead.
	 */
	public async start(): Promise<Record<string, string>> {
		try {
			this.token = crypto.randomBytes(24).toString("hex")

			// 0o700 so no other account can reach the socket or read the helper.
			this.directory = await fs.mkdtemp(path.join(os.tmpdir(), "roo-askpass-"))
			await fs.chmod(this.directory, 0o700)

			const socketPath = path.join(this.directory, "sock")
			await this.listen(socketPath)

			this.helperPath = await this.writeHelper(socketPath)

			return {
				GIT_ASKPASS: this.helperPath,
				SSH_ASKPASS: this.helperPath,
				// sudo only consults SUDO_ASKPASS when it is invoked as `sudo -A`,
				// so this helps that case and changes nothing otherwise.
				SUDO_ASKPASS: this.helperPath,
				// ssh only consults SSH_ASKPASS on its own when it has no terminal
				// AND DISPLAY is set. "force" removes both conditions.
				SSH_ASKPASS_REQUIRE: "force",
			}
			// GIT_TERMINAL_PROMPT stays at 0, set by the caller: git tries askpass
			// first and only falls back to the terminal if the helper produced
			// nothing, so leaving the fallback disabled costs no functionality and
			// keeps the clear "terminal prompts disabled" error. Verified against
			// git 2.x with both variables set at once.
		} catch (error) {
			console.warn(
				`[AskpassServer#start] could not set up the askpass bridge: ${error instanceof Error ? error.message : String(error)}`,
			)

			await this.dispose()
			return {}
		}
	}

	private listen(socketPath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const server = net.createServer((socket) => this.onConnection(socket))
			server.once("error", reject)
			server.listen(socketPath, () => {
				server.removeListener("error", reject)
				this.server = server
				resolve()
			})
		})
	}

	private onConnection(socket: net.Socket) {
		let buffer = ""

		socket.setEncoding("utf8")

		socket.on("data", async (chunk: string) => {
			buffer += chunk

			const newline = buffer.indexOf("\n")

			if (newline === -1) {
				// A question longer than one chunk is still arriving.
				if (buffer.length > 8192) {
					socket.destroy()
				}

				return
			}

			const line = buffer.slice(0, newline)
			buffer = ""

			let request: AskpassWire

			try {
				request = JSON.parse(line) as AskpassWire
			} catch {
				socket.destroy()
				return
			}

			// Any local process could connect to the socket; only the command we
			// started knows the token, which it received through its environment.
			if (typeof request.token !== "string" || !this.tokenMatches(request.token)) {
				socket.destroy()
				return
			}

			const prompt = typeof request.prompt === "string" ? request.prompt : ""

			let answer: string | undefined

			try {
				answer = await this.handler({
					prompt,
					command: this.command,
					isSecret: looksLikeSecret(prompt),
				})
			} catch (error) {
				console.warn(
					`[AskpassServer] prompt handler failed: ${error instanceof Error ? error.message : String(error)}`,
				)
			}

			const response = typeof answer === "string" ? JSON.stringify({ answer }) : JSON.stringify({ answer: null })

			socket.end(`${response}\n`)
		})

		socket.on("error", () => socket.destroy())
	}

	private tokenMatches(candidate: string): boolean {
		const expected = Buffer.from(this.token)
		const actual = Buffer.from(candidate)

		// Equal length is required before comparing, and checking it separately
		// is safe: the token's length is not a secret.
		return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
	}

	/**
	 * The helper is generated at runtime rather than shipped as an asset,
	 * because the extension and the CLI are bundled by different builds and
	 * neither copies loose files. `process.execPath` is the node binary already
	 * running us, so the helper needs nothing installed to work.
	 */
	private async writeHelper(socketPath: string): Promise<string> {
		const scriptPath = path.join(this.directory!, "askpass.js")
		const shimPath = path.join(this.directory!, "askpass")

		await fs.writeFile(scriptPath, HELPER_SOURCE, { mode: 0o700 })

		// git and ssh exec the value of GIT_ASKPASS/SSH_ASKPASS directly, so it
		// has to be an executable file rather than a command line.
		const shim = [
			"#!/bin/sh",
			`ROO_ASKPASS_SOCKET=${shellQuote(socketPath)} \\`,
			`ROO_ASKPASS_TOKEN=${shellQuote(this.token)} \\`,
			`exec ${shellQuote(process.execPath)} ${shellQuote(scriptPath)} "$@"`,
			"",
		].join("\n")

		await fs.writeFile(shimPath, shim, { mode: 0o700 })

		return shimPath
	}

	public async dispose(): Promise<void> {
		const server = this.server
		this.server = undefined

		if (server) {
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}

		if (this.directory) {
			try {
				await fs.rm(this.directory, { recursive: true, force: true })
			} catch {
				// A leftover directory in tmp is not worth failing a command over.
			}

			this.directory = undefined
		}
	}
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Runs as its own process, started by git/ssh/sudo. Written in the style those
 * programs expect: the answer on stdout, and a non-zero exit when there is no
 * answer, which makes the command fail rather than wait.
 */
const HELPER_SOURCE = `"use strict"
const net = require("net")

const socketPath = process.env.ROO_ASKPASS_SOCKET
const token = process.env.ROO_ASKPASS_TOKEN
const prompt = process.argv[2] || ""

if (!socketPath || !token) {
	process.exit(1)
}

const socket = net.connect(socketPath)
let buffer = ""

socket.setEncoding("utf8")
socket.on("connect", () => socket.write(JSON.stringify({ token: token, prompt: prompt }) + "\\n"))
socket.on("data", (chunk) => {
	buffer += chunk

	const newline = buffer.indexOf("\\n")

	if (newline === -1) {
		return
	}

	let answer = null

	try {
		answer = JSON.parse(buffer.slice(0, newline)).answer
	} catch (e) {}

	socket.end()

	if (typeof answer !== "string") {
		process.exit(1)
	}

	process.stdout.write(answer + "\\n", () => process.exit(0))
})
socket.on("error", () => process.exit(1))
socket.on("close", () => process.exit(1))
`
