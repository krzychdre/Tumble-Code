import { execFileSync, spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"

import {
	createGitClaimEvidenceLookup,
	runCommand,
	type ClaimEvidenceLookup,
	type CommandRunner,
} from "../claimEvidence"
import type { ClaimRef } from "../timeBoundClaims"

const hasGit = spawnSync("git", ["--version"]).status === 0

let tick = 0

/** Runs git in a test repository, isolated from the user's git config, with a fixed date per commit. */
function git(cwd: string, ...args: string[]): string {
	const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1" }
	if (["commit", "merge"].includes(args[0])) {
		const date = new Date(Date.UTC(2026, 8, 20 + tick++, 12)).toISOString()
		env.GIT_AUTHOR_DATE = date
		env.GIT_COMMITTER_DATE = date
	}
	return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
		cwd,
		env,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim()
}

function write(dir: string, file: string, content: string) {
	fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
	fs.writeFileSync(path.join(dir, file), content)
}

function commitFile(dir: string, file: string, content: string, message: string): string {
	write(dir, file, content)
	git(dir, "add", "-A")
	git(dir, "commit", "-q", "-m", message)
	return git(dir, "rev-parse", "HEAD")
}

const short = (dir: string, sha: string) => git(dir, "rev-parse", "--short", sha)

const pr = (number: number): ClaimRef => ({ kind: "pr", number })
const commit = (sha: string): ClaimRef => ({ kind: "commit", sha })
const branch = (name: string): ClaimRef => ({ kind: "branch", name })
const file = (p: string): ClaimRef => ({ kind: "file", path: p })

const signal = () => new AbortController().signal

describe.skipIf(!hasGit)("createGitClaimEvidenceLookup", () => {
	let root: string
	let repo: string
	const sha: Record<string, string> = {}

	beforeAll(() => {
		root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "roo-claims-"))
		repo = path.join(root, "repo")
		fs.mkdirSync(repo)
		git(repo, "init", "-q", "-b", "main")
		write(repo, "README.md", "hello\n")
		sha.init = commitFile(repo, "docs/a.md", "a\n", "init") // 09-20

		// Fast-forward merge.
		git(repo, "checkout", "-q", "-b", "feat/ff")
		commitFile(repo, "ff.txt", "ff\n", "ff work") // 09-21
		git(repo, "checkout", "-q", "main")
		git(repo, "merge", "-q", "--ff-only", "feat/ff") // tick 09-22 (no commit)

		// Squash merge "(#12)", then a newer "(#120)" so a naive "#12" search finds the wrong commit.
		git(repo, "checkout", "-q", "-b", "feat/squashed")
		commitFile(repo, "sq.txt", "one\n", "sq 1") // 09-23
		commitFile(repo, "sq.txt", "two\n", "sq 2") // 09-24
		git(repo, "checkout", "-q", "main")
		git(repo, "merge", "-q", "--squash", "feat/squashed") // 09-25 (no commit)
		git(repo, "commit", "-q", "-m", "feat: x (#12)") // 09-26
		sha.squash = git(repo, "rev-parse", "HEAD")
		sha.pr120 = commitFile(repo, "other.txt", "o\n", "chore: y (#120)") // 09-27

		// Merge commit.
		git(repo, "checkout", "-q", "-b", "feature/pr34")
		commitFile(repo, "pr34.txt", "p\n", "pr34 work") // 09-28
		git(repo, "checkout", "-q", "main")
		git(repo, "merge", "-q", "--no-ff", "-m", "Merge pull request #34 from someone/feature-pr34", "feature/pr34") // 09-29
		sha.merge34 = git(repo, "rev-parse", "HEAD")

		// A revert subject names the PR but is not its merge.
		git(repo, "commit", "-q", "--allow-empty", "-m", 'Revert "feat: z (#77)"') // 09-30

		// Unmerged branch with two commits.
		git(repo, "checkout", "-q", "-b", "fix/unmerged")
		sha.un1 = commitFile(repo, "un.txt", "1\n", "un 1") // 10-01
		sha.un2 = commitFile(repo, "un.txt", "2\n", "un 2") // 10-02
		git(repo, "checkout", "-q", "main")

		// Remote-tracking refs without a remote: origin/main one commit ahead, remote-only branches.
		git(repo, "checkout", "-q", "-b", "tmp")
		git(repo, "commit", "-q", "--allow-empty", "-m", "feat: remote only (#88)")
		git(repo, "update-ref", "refs/remotes/origin/main", "HEAD")
		git(repo, "checkout", "-q", "main")
		git(repo, "branch", "-q", "-D", "tmp")
		git(repo, "update-ref", "refs/remotes/origin/feat/remote-unmerged", sha.un2)
		git(repo, "update-ref", "refs/remotes/origin/feat/remote-merged", sha.pr120)
	})

	afterAll(() => {
		if (root) fs.rmSync(root, { recursive: true, force: true })
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	const lookup = (refs: ClaimRef[], dir = repo) => createGitClaimEvidenceLookup(dir, { gh: false })(refs, signal())

	it("finds a squash-merged PR by its exact number", async () => {
		const [twelve, oneTwenty, one] = await lookup([pr(12), pr(120), pr(1)])
		expect(twelve).toEqual({
			ref: pr(12),
			landed: true,
			text: `PR #12 is on main as commit ${short(repo, sha.squash)} (2026-09-26).`,
		})
		expect(oneTwenty.text).toBe(`PR #120 is on main as commit ${short(repo, sha.pr120)} (2026-09-27).`)
		expect(one).toEqual({
			ref: pr(1),
			landed: undefined,
			text: "No commit on main names PR #1 (not merged yet, or a number from another repository).",
		})
	})

	it("finds a PR merged with a merge commit, not a shorter number", async () => {
		const [pr34, pr3] = await lookup([pr(34), pr(3)])
		expect(pr34).toMatchObject({
			landed: true,
			text: `PR #34 is on main as commit ${short(repo, sha.merge34)} (2026-09-29).`,
		})
		expect(pr3.landed).toBeUndefined()
	})

	it("ignores a revert subject and finds a PR that is only on origin/main", async () => {
		const [reverted, remote] = await lookup([pr(77), pr(88)])
		expect(reverted.landed).toBeUndefined()
		expect(remote.landed).toBe(true)
		expect(remote.text).toBe(`PR #88 is on main as commit ${short(repo, "origin/main")} (2026-10-03).`)
	})

	it("checks commits: on main, elsewhere, missing", async () => {
		const onMain = short(repo, sha.squash)
		const [a, b, c, d] = await lookup([commit(onMain), commit(sha.un1), commit("deadbeef1234"), commit("-x")])
		expect(a).toEqual({ ref: commit(onMain), landed: true, text: `Commit ${onMain} is on main.` })
		expect(b).toEqual({ ref: commit(sha.un1), landed: false, text: `Commit ${sha.un1} exists but is not on main.` })
		expect(c).toEqual({
			ref: commit("deadbeef1234"),
			landed: undefined,
			text: "Commit deadbeef1234 is not in this repository.",
		})
		expect(d.landed).toBeUndefined()
	})

	it("checks branches: fast-forwarded, squash-merged, unmerged, missing", async () => {
		const [ff, squashed, unmerged, gone] = await lookup([
			branch("feat/ff"),
			branch("feat/squashed"),
			branch("fix/unmerged"),
			branch("fix/gone"),
		])
		expect(ff).toEqual({ ref: branch("feat/ff"), landed: true, text: "All commits of branch feat/ff are on main." })
		expect(squashed).toEqual({
			ref: branch("feat/squashed"),
			landed: true,
			text: "Branch feat/squashed has no change that main lacks (squash-merged or applied otherwise).",
		})
		expect(unmerged.landed).toBe(false)
		expect(unmerged.text).toBe("Branch fix/unmerged has 2 commits that are not on main, the last from 2026-10-02.")
		expect(gone).toEqual({
			ref: branch("fix/gone"),
			landed: undefined,
			text: "No branch named fix/gone exists here (deleted after merge, or never pushed).",
		})
	})

	it("checks branches that exist only as origin/ refs and rejects unsafe names", async () => {
		const [merged, unmerged, unsafe] = await lookup([
			branch("feat/remote-merged"),
			branch("feat/remote-unmerged"),
			branch("--all"),
		])
		expect(merged.landed).toBe(true)
		expect(unmerged.landed).toBe(false)
		expect(unsafe).toMatchObject({ landed: undefined, text: "--all is not a valid branch name." })
	})

	it("checks files on the default branch", async () => {
		const [a, missing, branchOnly] = await lookup([file("docs/a.md"), file("docs/missing.md"), file("un.txt")])
		expect(a).toEqual({ ref: file("docs/a.md"), landed: true, text: "File docs/a.md exists on main." })
		expect(missing).toEqual({
			ref: file("docs/missing.md"),
			landed: false,
			text: "File docs/missing.md does not exist on main.",
		})
		expect(branchOnly.landed).toBe(false)
	})

	it("uses the origin/HEAD target as the default branch, else master", async () => {
		const trunk = path.join(root, "trunk")
		fs.mkdirSync(trunk)
		git(trunk, "init", "-q", "-b", "main")
		commitFile(trunk, "docs/old.md", "old\n", "old")
		git(trunk, "checkout", "-q", "-b", "trunk")
		commitFile(trunk, "docs/new.md", "new\n", "new")
		git(trunk, "update-ref", "refs/remotes/origin/trunk", "HEAD")
		git(trunk, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk")
		git(trunk, "checkout", "-q", "main")
		git(trunk, "branch", "-q", "-D", "trunk")
		const [onTrunk] = await lookup([file("docs/new.md")], trunk)
		expect(onTrunk).toMatchObject({ landed: true, text: "File docs/new.md exists on trunk." })

		const master = path.join(root, "master")
		fs.mkdirSync(master)
		git(master, "init", "-q", "-b", "master")
		commitFile(master, "docs/m.md", "m\n", "m")
		const [onMaster] = await lookup([file("docs/m.md")], master)
		expect(onMaster).toMatchObject({ landed: true, text: "File docs/m.md exists on master." })
	})

	it("answers undefined for every ref outside a git repository", async () => {
		const plain = path.join(root, "plain")
		fs.mkdirSync(plain, { recursive: true })
		vi.stubEnv("GIT_CEILING_DIRECTORIES", root)
		const evidence = await lookup([pr(12), branch("feat/ff")], plain)
		expect(evidence).toEqual([
			{ ref: pr(12), landed: undefined, text: "Cannot check PR #12: this folder is not a git repository." },
			{
				ref: branch("feat/ff"),
				landed: undefined,
				text: "Cannot check branch feat/ff: this folder is not a git repository.",
			},
		])
	})

	it("answers undefined when git is not installed", async () => {
		vi.stubEnv("PATH", "")
		const [evidence] = await lookup([file("docs/a.md")])
		expect(evidence).toEqual({
			ref: file("docs/a.md"),
			landed: undefined,
			text: "Cannot check file docs/a.md: git is not available.",
		})
	})

	it("caches results per instance", async () => {
		let calls = 0
		const run: CommandRunner = (f, args, opts) => {
			calls++
			return runCommand(f, args, opts)
		}
		const check: ClaimEvidenceLookup = createGitClaimEvidenceLookup(repo, { gh: false, run })
		const first = await check([pr(12), branch("feat/squashed"), pr(12)], signal())
		const afterFirst = calls
		expect(first[0]).toEqual(first[2])
		const second = await check([branch("feat/squashed"), pr(12)], signal())
		expect(calls).toBe(afterFirst)
		expect(second).toEqual([first[1], first[0]])
	})

	it("rejects on abort without poisoning the cache", async () => {
		const check = createGitClaimEvidenceLookup(repo, { gh: false })
		const controller = new AbortController()
		controller.abort()
		await expect(check([pr(12)], controller.signal)).rejects.toThrow()
		const [evidence] = await check([pr(12)], signal())
		expect(evidence.landed).toBe(true)
	})

	it("keeps going when one command fails", async () => {
		const run: CommandRunner = (f, args, opts) =>
			args.includes("cat-file") ? Promise.reject(new Error("boom")) : runCommand(f, args, opts)
		const check = createGitClaimEvidenceLookup(repo, { gh: false, run })
		const [broken, fine] = await check([file("docs/a.md"), pr(12)], signal())
		expect(broken).toEqual({
			ref: file("docs/a.md"),
			landed: undefined,
			text: "Cannot check file docs/a.md: git did not answer.",
		})
		expect(fine.landed).toBe(true)
	})

	describe("gh fallback for deleted branches", () => {
		it("reports a merged PR for a branch that no longer exists", async () => {
			const ghCalls: string[][] = []
			const run: CommandRunner = (f, args, opts) => {
				if (f !== "gh") return runCommand(f, args, opts)
				ghCalls.push(args)
				return Promise.resolve({ code: 0, stdout: '[{"number":42,"mergedAt":"2026-09-29T08:00:00Z"}]' })
			}
			const check = createGitClaimEvidenceLookup(repo, { run })
			const [gone, existing] = await check([branch("fix/gone"), branch("feat/ff")], signal())
			expect(gone).toEqual({
				ref: branch("fix/gone"),
				landed: true,
				text: "Branch fix/gone was merged as PR #42 on 2026-09-29; the branch is deleted.",
			})
			expect(existing.text).toBe("All commits of branch feat/ff are on main.")
			expect(ghCalls).toEqual([
				["pr", "list", "--head=fix/gone", "--state=merged", "--json=number,mergedAt", "--limit=1"],
			])
		})

		it("stops asking gh once it is missing, and ignores gh errors", async () => {
			let ghCalls = 0
			const run: CommandRunner = (f, args, opts) => {
				if (f !== "gh") return runCommand(f, args, opts)
				ghCalls++
				return Promise.resolve({ code: -1, stdout: "", notFound: true })
			}
			const check = createGitClaimEvidenceLookup(repo, { run })
			const evidence = await check([branch("fix/gone"), branch("fix/gone-too")], signal())
			expect(evidence.map((e) => e.landed)).toEqual([undefined, undefined])
			expect(ghCalls).toBe(1)

			const failing = createGitClaimEvidenceLookup(repo, {
				run: (f, args, opts) =>
					f === "gh" ? Promise.resolve({ code: 0, stdout: "not json" }) : runCommand(f, args, opts),
			})
			const [ignored] = await failing([branch("fix/gone")], signal())
			expect(ignored.landed).toBeUndefined()
		})
	})
})
