/**
 * Git evidence for time-bound memory claims: what the repository says about
 * the references a clause names (a PR number, a commit, a branch, a file).
 *
 * The dream runs on small local models, so every fact the model sees comes
 * from here as one short plain sentence, and `landed` carries the verdict the
 * gate in the dream relies on ({@link allRefsLanded} in timeBoundClaims.ts).
 *
 * Read-only on refs and the worktree: no fetch, no checkout, no ref update.
 * The one command that writes anything is `git merge-tree --write-tree`
 * (squash detection), which can add unreferenced objects that gc prunes.
 */

import { execFile } from "child_process"
import { promises as fs } from "fs"

import { type ClaimEvidence, type ClaimRef, describeRef } from "./timeBoundClaims"

/** Evidence for each reference, one per input ref and in the same order. Rejects only on abort. */
export type ClaimEvidenceLookup = (refs: ReadonlyArray<ClaimRef>, signal: AbortSignal) => Promise<ClaimEvidence[]>

export interface CommandResult {
	/** Exit code; -1 when the program did not run to completion (not found, timed out, killed). */
	code: number
	stdout: string
	/** The program (or the folder to run it in) does not exist. */
	notFound?: boolean
}

/** Runs one command without a shell. Rejects only when the signal aborts. */
export type CommandRunner = (
	file: "git" | "gh",
	args: string[],
	options: { cwd: string; timeoutMs: number; signal: AbortSignal; maxBytes?: number },
) => Promise<CommandResult>

const GIT_TIMEOUT_MS = 5_000
const GH_TIMEOUT_MS = 8_000
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

export const runCommand: CommandRunner = (file, args, { cwd, timeoutMs, signal, maxBytes }) =>
	new Promise((resolve, reject) => {
		execFile(
			file,
			args,
			{
				cwd,
				timeout: timeoutMs,
				signal,
				maxBuffer: maxBytes ?? MAX_OUTPUT_BYTES,
				windowsHide: true,
				encoding: "utf8",
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GH_PROMPT_DISABLED: "1" },
			},
			(error, stdout) => {
				if (signal.aborted) return reject(signal.reason)
				if (!error) return resolve({ code: 0, stdout })
				const code = typeof error.code === "number" ? error.code : -1
				resolve({ code, stdout: String(stdout ?? ""), notFound: error.code === "ENOENT" })
			},
		)
	})

interface GitLookupOptions {
	/** Ask the gh CLI about branches that no longer exist. Default true; skipped when gh is not installed. */
	gh?: boolean
	/** Command runner, replaceable in tests. */
	run?: CommandRunner
}

/**
 * The default branch: its short name and the ref that counts. When origin/ has
 * it, only origin/ counts: a commit on the local main alone is not pushed, so
 * it must not settle a "not pushed" claim.
 */
export type DefaultBranch = { ok: true; name: string; refs: string[] } | { ok: false; why: string }

type Git = (args: string[], signal: AbortSignal) => Promise<CommandResult>

/** Existing refs among `names`, dropping a ref whose tip equals an earlier one. */
async function refTips(git: Git, names: string[], signal: AbortSignal): Promise<string[] | undefined> {
	const res = await git(["for-each-ref", "--format=%(objectname) %(refname)", ...names], signal)
	if (res.code !== 0) return undefined
	const tips = new Map<string, string>()
	for (const line of res.stdout.split("\n")) {
		const [sha, name] = line.trim().split(" ")
		if (sha && name) tips.set(name, sha)
	}
	const seen = new Set<string>()
	return names.filter((name) => {
		const sha = tips.get(name)
		if (!sha || seen.has(sha)) return false
		seen.add(sha)
		return true
	})
}

async function folderExists(cwd: string): Promise<boolean> {
	try {
		return (await fs.stat(cwd)).isDirectory()
	} catch {
		return false
	}
}

/**
 * The repository's default branch: the origin/HEAD target, else main, else
 * master; origin/ when it has the branch (see {@link DefaultBranch}). Shared by
 * the claim evidence and the snapshot drift check.
 */
export async function resolveDefaultBranch(cwd: string, git: Git, signal: AbortSignal): Promise<DefaultBranch> {
	const probe = await git(["rev-parse", "--git-dir"], signal)
	if (probe.notFound) {
		return { ok: false, why: (await folderExists(cwd)) ? "git is not available" : "the folder does not exist" }
	}
	if (probe.code !== 0) return { ok: false, why: "this folder is not a git repository" }
	const names: string[] = []
	const head = await git(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], signal)
	const target = head.code === 0 ? head.stdout.trim() : ""
	if (target.startsWith("refs/remotes/origin/")) names.push(target.slice("refs/remotes/origin/".length))
	for (const name of ["main", "master"]) if (!names.includes(name)) names.push(name)
	const wanted = names.flatMap((name) => [`refs/remotes/origin/${name}`, `refs/heads/${name}`])
	const existing = await refTips(git, wanted, signal)
	if (!existing) return { ok: false, why: "git did not answer" }
	for (const name of names) {
		const remote = `refs/remotes/origin/${name}`
		if (existing.includes(remote)) return { ok: true, name, refs: [remote] }
		if (existing.includes(`refs/heads/${name}`)) return { ok: true, name, refs: [`refs/heads/${name}`] }
	}
	return { ok: false, why: "the repository has no main or master branch" }
}

/** Branch names a memory can name; anything else (options, globs, `..`) is never passed to git. */
const SAFE_BRANCH_RE = /^(?!-)(?!.*\.\.)[\w./-]+$/
const SHA_RE = /^[0-9a-f]{4,40}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const unknown = (ref: ClaimRef, text: string): ClaimEvidence => ({ ref, landed: undefined, text })
const noAnswer = (ref: ClaimRef) => unknown(ref, `Cannot check ${describeRef(ref)}: git did not answer.`)
const commits = (n: number) => (n === 1 ? "1 commit that is" : `${n} commits that are`)

/**
 * A lookup bound to one repository folder. Results are cached for the life of
 * the instance (one dream run checks the same refs many times); the default
 * branch is resolved once.
 */
export function createGitClaimEvidenceLookup(cwd: string, options: GitLookupOptions = {}): ClaimEvidenceLookup {
	const run = options.run ?? runCommand
	let ghMissing = options.gh === false
	let repo: DefaultBranch | undefined
	const cache = new Map<string, ClaimEvidence>()
	const trees = new Map<string, string>()

	const git = (args: string[], signal: AbortSignal) =>
		run("git", ["-c", "log.showSignature=false", ...args], { cwd, timeoutMs: GIT_TIMEOUT_MS, signal })

	/** Whether `rev` is contained in the default branch (local or origin/); undefined when git fails. */
	async function onDefault(rev: string, defaults: string[], signal: AbortSignal): Promise<boolean | undefined> {
		for (const ref of defaults) {
			const res = await git(["merge-base", "--is-ancestor", rev, ref], signal)
			if (res.code === 0) return true
			if (res.code !== 1) return undefined
		}
		return false
	}

	/** Whether merging `branch` into the default branch would change nothing: its content is already there. */
	async function contentOnDefault(branch: string, defaults: string[], signal: AbortSignal): Promise<boolean> {
		for (const ref of defaults) {
			let tree = trees.get(ref)
			if (tree === undefined) {
				const res = await git(["rev-parse", `${ref}^{tree}`], signal)
				if (res.code !== 0) continue
				tree = res.stdout.trim()
				trees.set(ref, tree)
			}
			const merged = await git(["merge-tree", "--write-tree", ref, branch], signal)
			if (merged.code === 0 && merged.stdout.split("\n")[0].trim() === tree) return true
		}
		return false
	}

	async function checkPr(ref: ClaimRef & { kind: "pr" }, r: DefaultBranch & { ok: true }, signal: AbortSignal) {
		const n = ref.number
		if (!Number.isSafeInteger(n) || n < 1) return unknown(ref, `#${n} is not a valid pull request number.`)
		const res = await git(
			["log", "-E", `--grep=#${n}([^0-9]|$)`, "--format=%h%x09%cs%x09%s", ...r.refs, "--"],
			signal,
		)
		if (res.code !== 0) return noAnswer(ref)
		// Squash merge "title (#N)" or merge commit "Merge pull request #N from ...", never #NN.
		const subjectRe = new RegExp(`\\(#${n}\\)|\\bpull request #${n}(?!\\d)`, "i")
		for (const line of res.stdout.split("\n")) {
			const [hash, date, ...rest] = line.split("\t")
			const subject = rest.join("\t")
			if (!hash || !subject || /^revert\b/i.test(subject) || !subjectRe.test(subject)) continue
			return { ref, landed: true, text: `PR #${n} is on ${r.name} as commit ${hash} (${date}).` }
		}
		return unknown(
			ref,
			`No commit on ${r.name} names PR #${n} (not merged yet, or a number from another repository).`,
		)
	}

	async function checkCommit(ref: ClaimRef & { kind: "commit" }, r: DefaultBranch & { ok: true }, signal: AbortSignal) {
		const { sha } = ref
		if (!SHA_RE.test(sha)) return unknown(ref, `Commit ${sha} is not a valid commit hash.`)
		const res = await git(["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], signal)
		if (res.code === -1) return noAnswer(ref)
		if (res.code !== 0) return unknown(ref, `Commit ${sha} is not in this repository.`)
		const landed = await onDefault(res.stdout.trim(), r.refs, signal)
		if (landed === undefined) return noAnswer(ref)
		return landed
			? { ref, landed, text: `Commit ${sha} is on ${r.name}.` }
			: { ref, landed, text: `Commit ${sha} exists but is not on ${r.name}.` }
	}

	async function checkGh(
		ref: ClaimRef & { kind: "branch" },
		signal: AbortSignal,
	): Promise<ClaimEvidence | undefined> {
		if (ghMissing) return undefined
		try {
			const res = await run(
				"gh",
				["pr", "list", `--head=${ref.name}`, "--state=merged", "--json=number,mergedAt", "--limit=1"],
				{ cwd, timeoutMs: GH_TIMEOUT_MS, signal },
			)
			if (res.notFound) ghMissing = true
			if (res.code !== 0) return undefined
			const [pr] = JSON.parse(res.stdout) as Array<{ number?: unknown; mergedAt?: unknown }>
			if (!pr || typeof pr.number !== "number" || !Number.isInteger(pr.number)) return undefined
			const date = typeof pr.mergedAt === "string" ? pr.mergedAt.slice(0, 10) : ""
			const on = DATE_RE.test(date) ? ` on ${date}` : ""
			return {
				ref,
				landed: true,
				text: `Branch ${ref.name} was merged as PR #${pr.number}${on}; the branch is deleted.`,
			}
		} catch (error) {
			if (signal.aborted) throw error
			return undefined
		}
	}

	async function checkBranch(ref: ClaimRef & { kind: "branch" }, r: DefaultBranch & { ok: true }, signal: AbortSignal) {
		const { name } = ref
		if (!SAFE_BRANCH_RE.test(name)) return unknown(ref, `${name} is not a valid branch name.`)
		const refs = await refTips(git, [`refs/heads/${name}`, `refs/remotes/origin/${name}`], signal)
		if (!refs) return noAnswer(ref)
		if (refs.length === 0) {
			return (
				(await checkGh(ref, signal)) ??
				unknown(ref, `No branch named ${name} exists here (deleted after merge, or never pushed).`)
			)
		}
		// Landed only when every copy (local and origin/) has landed.
		let squashed = false
		for (const branch of refs) {
			const ancestor = await onDefault(branch, r.refs, signal)
			if (ancestor === undefined) return noAnswer(ref)
			if (ancestor) continue
			if (await contentOnDefault(branch, r.refs, signal)) {
				squashed = true
				continue
			}
			const count = await git(["rev-list", "--count", branch, "--not", ...r.refs, "--"], signal)
			const last = await git(["log", "-1", "--format=%cs", branch, "--"], signal)
			const n = Number(count.stdout.trim())
			const date = last.stdout
				.split("\n")
				.find((l) => DATE_RE.test(l.trim()))
				?.trim()
			const text =
				count.code === 0 && n > 0
					? `Branch ${name} has ${commits(n)} not on ${r.name}${date ? `, the last from ${date}` : ""}.`
					: `Branch ${name} has commits that are not on ${r.name}.`
			return { ref, landed: false, text }
		}
		return squashed
			? {
					ref,
					landed: true,
					text: `Branch ${name} has no change that ${r.name} lacks (squash-merged or applied otherwise).`,
				}
			: { ref, landed: true, text: `All commits of branch ${name} are on ${r.name}.` }
	}

	async function checkFile(ref: ClaimRef & { kind: "file" }, r: DefaultBranch & { ok: true }, signal: AbortSignal) {
		const path = ref.path.replace(/^\.\//, "")
		for (const def of r.refs) {
			const res = await git(["cat-file", "-e", `${def}:${path}`], signal)
			if (res.code === -1) return noAnswer(ref)
			if (res.code === 0) return { ref, landed: true, text: `File ${ref.path} exists on ${r.name}.` }
		}
		return { ref, landed: false, text: `File ${ref.path} does not exist on ${r.name}.` }
	}

	async function check(ref: ClaimRef, signal: AbortSignal): Promise<ClaimEvidence> {
		try {
			repo ??= await resolveDefaultBranch(cwd, git, signal)
			const r = repo
			if (!r.ok) return unknown(ref, `Cannot check ${describeRef(ref)}: ${r.why}.`)
			switch (ref.kind) {
				case "pr":
					return await checkPr(ref, r, signal)
				case "commit":
					return await checkCommit(ref, r, signal)
				case "branch":
					return await checkBranch(ref, r, signal)
				case "file":
					return await checkFile(ref, r, signal)
			}
		} catch (error) {
			if (signal.aborted) throw error
			return noAnswer(ref)
		}
	}

	return async (refs, signal) => {
		const evidence: ClaimEvidence[] = []
		for (const ref of refs) {
			signal.throwIfAborted()
			const key = `${ref.kind}:${describeRef(ref)}`
			let found = cache.get(key)
			if (!found) {
				found = await check(ref, signal)
				cache.set(key, found)
			}
			evidence.push(found.ref === ref ? found : { ...found, ref })
		}
		return evidence
	}
}
