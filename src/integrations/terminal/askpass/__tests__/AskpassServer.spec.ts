// npx vitest run integrations/terminal/askpass/__tests__/AskpassServer.spec.ts

import { execa } from "execa"
import fs from "fs/promises"
import net from "net"
import os from "os"
import path from "path"

import { AskpassServer, type AskpassRequest } from "../AskpassServer"

// These exercise the real socket and the real helper process, because the whole
// point of the bridge is what git and ssh do with it, and a mocked socket would
// prove nothing about that.
const describeOnPosix = process.platform === "win32" ? describe.skip : describe

describeOnPosix("AskpassServer", () => {
	let server: AskpassServer | undefined

	afterEach(async () => {
		await server?.dispose()
		server = undefined
	})

	async function startWith(answer: string | undefined, command = "git clone https://example.com/x.git") {
		const seen: AskpassRequest[] = []
		server = new AskpassServer(command, async (request) => {
			seen.push(request)
			return answer
		})
		const env = await server.start()
		return { env, seen }
	}

	it("hands the helper's question to the host and its answer back", async () => {
		const { env, seen } = await startWith("hunter2")

		// Exactly how git runs it: the program named by GIT_ASKPASS, with the
		// question as its only argument.
		const result = await execa(env.GIT_ASKPASS, ["Password for 'https://github.com':"])

		expect(result.stdout).toBe("hunter2")
		expect(result.exitCode).toBe(0)
		expect(seen).toHaveLength(1)
		expect(seen[0].prompt).toBe("Password for 'https://github.com':")
		expect(seen[0].command).toBe("git clone https://example.com/x.git")
	})

	it("points git, ssh and sudo at the same helper", async () => {
		const { env } = await startWith("x")

		expect(env.GIT_ASKPASS).toBe(env.SSH_ASKPASS)
		expect(env.SUDO_ASKPASS).toBe(env.GIT_ASKPASS)
		// Without "force", ssh ignores SSH_ASKPASS unless DISPLAY is set.
		expect(env.SSH_ASKPASS_REQUIRE).toBe("force")
	})

	it("treats a password as a secret but a host key confirmation as plain text", async () => {
		const { env, seen } = await startWith("yes")

		await execa(env.GIT_ASKPASS, ["Password for 'https://github.com':"])
		await execa(env.SSH_ASKPASS, ["Are you sure you want to continue connecting (yes/no/[fingerprint])?"])

		expect(seen[0].isSecret).toBe(true)
		// Masking this one would have the user typing an invisible "yes".
		expect(seen[1].isSecret).toBe(false)
	})

	it("fails the helper when the user dismisses the prompt, so the command stops waiting", async () => {
		const { env } = await startWith(undefined)

		await expect(execa(env.GIT_ASKPASS, ["Password:"])).rejects.toMatchObject({ exitCode: 1 })
	})

	it("drops a caller that reaches the socket without the token", async () => {
		const { env, seen } = await startWith("hunter2")

		// Straight at the socket, the way a process that found it but could not
		// read the helper script would have to come. The directory is 0700, but
		// socket file permissions are not enforced on every platform, so the
		// token is what actually has to hold here.
		const socketPath = path.join(path.dirname(env.GIT_ASKPASS), "sock")

		const closed = await new Promise<boolean>((resolve) => {
			const client = net.connect(socketPath, () => {
				client.write(JSON.stringify({ token: "wrong", prompt: "Password:" }) + "\n")
			})
			client.on("data", () => resolve(false))
			client.on("close", () => resolve(true))
			client.on("error", () => resolve(true))
		})

		expect(closed).toBe(true)
		expect(seen).toHaveLength(0)
	})

	it("answers a real ssh passphrase prompt from a command with no terminal", async () => {
		// The end of the chain the whole branch exists for: ssh asks, the user
		// answers inside the interface, the command carries on. ssh-keygen is
		// used because it needs no network and no server.
		const hasSshKeygen = await execa("sh", ["-c", "command -v ssh-keygen"], { reject: false })

		if (hasSshKeygen.exitCode !== 0) {
			return
		}

		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "askpass-ssh-"))

		try {
			const keyPath = path.join(directory, "key")
			await execa("ssh-keygen", ["-q", "-t", "ed25519", "-N", "correct horse", "-f", keyPath, "-C", "probe"])

			const { env, seen } = await startWith("correct horse", `ssh-keygen -y -f ${keyPath}`)

			// `SSH_ASKPASS_REQUIRE=force` in the returned env is what makes ssh
			// use the helper rather than look for a terminal, which is also what
			// saves this test from needing setsid (absent on macOS).
			const result = await execa("ssh-keygen", ["-y", "-f", keyPath], {
				env,
				extendEnv: true,
				stdin: "ignore",
			})

			expect(result.stdout).toMatch(/^ssh-ed25519 /)
			expect(seen).toHaveLength(1)
			expect(seen[0].prompt).toContain("passphrase")
		} finally {
			await fs.rm(directory, { recursive: true, force: true })
		}
	})

	it("leaves nothing readable behind after dispose", async () => {
		const { env } = await startWith("hunter2")
		const helperPath = env.GIT_ASKPASS

		await server!.dispose()
		server = undefined

		await expect(fs.stat(helperPath)).rejects.toMatchObject({ code: "ENOENT" })
	})
})
