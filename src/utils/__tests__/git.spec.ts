// The git helpers against a real repository in a temporary directory, with the user's and the
// system's git configuration switched off, so nothing on the machine changes the output. Only the
// vscode workspace folders are a stand-in.

import { execFileSync } from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import {
	checkGitInstalled,
	searchCommits,
	getCommitInfo,
	getWorkingState,
	getGitRepositoryInfo,
	sanitizeGitUrl,
	extractRepositoryName,
	getWorkspaceGitInfo,
	convertGitUrlToHttps,
	getGitStatus,
} from "../git"
import { logger } from "../logging"

// GIT_CONFIG_GLOBAL is set to an empty file in the temp dir: git on Windows cannot read os.devNull (\\.\nul).
const ISOLATED_GIT = {
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "Ann Author",
	GIT_AUTHOR_EMAIL: "ann@example.com",
	GIT_COMMITTER_NAME: "Ann Author",
	GIT_COMMITTER_EMAIL: "ann@example.com",
}
const savedEnv: Record<string, string | undefined> = {}

let root: string
let repo: string
let notRepo: string
let commits: { hash: string; short: string }[]

const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim()

async function commit(file: string, content: string, message: string, date: string) {
	await fs.writeFile(path.join(repo, file), content)
	git("add", file)
	execFileSync("git", ["commit", "-q", "-m", message], {
		cwd: repo,
		env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
	})
	commits.push({ hash: git("rev-parse", "HEAD"), short: git("rev-parse", "--short", "HEAD") })
}

beforeAll(async () => {
	for (const [key, value] of Object.entries(ISOLATED_GIT)) {
		savedEnv[key] = process.env[key]
		process.env[key] = value
	}
	root = await fs.mkdtemp(path.join(os.tmpdir(), "git-spec-"))
	savedEnv.GIT_CONFIG_GLOBAL = process.env.GIT_CONFIG_GLOBAL
	process.env.GIT_CONFIG_GLOBAL = path.join(root, "gitconfig")
	await fs.writeFile(process.env.GIT_CONFIG_GLOBAL, "")
	repo = path.join(root, "repo")
	notRepo = path.join(root, "plain")
	await fs.mkdir(repo)
	await fs.mkdir(notRepo)
	commits = []
	git("init", "-q", "-b", "main")
	await commit("a.txt", "one\n", "feat: first feature\n\nThe longer description.", "2024-01-05T10:00:00Z")
	await commit("b.txt", "two\n", "fix: second change", "2024-01-06T10:00:00Z")
}, 30_000)

afterAll(async () => {
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[key]
		else process.env[key] = value
	}
	await fs.rm(root, { recursive: true, force: true })
})

beforeEach(() => {
	vi.spyOn(logger, "error").mockImplementation(() => {})
})

afterEach(async () => {
	vi.restoreAllMocks()
	git("reset", "-q", "--hard")
	git("clean", "-qfd")
})

describe("git commands", () => {
	it("finds git", async () => {
		expect(await checkGitInstalled()).toBe(true)
	})

	it("answers as if git were missing when it cannot be run", async () => {
		const savedPath = process.env.PATH
		process.env.PATH = ""
		try {
			expect(await checkGitInstalled()).toBe(false)
			expect(await searchCommits("fix", repo)).toEqual([])
			expect(await getCommitInfo("HEAD", repo)).toBe("Git is not installed")
			expect(await getWorkingState(repo)).toBe("Git is not installed")
			expect(await getGitStatus(repo)).toBeNull()
		} finally {
			process.env.PATH = savedPath
		}
	})

	it("answers outside a repository", async () => {
		expect(await searchCommits("fix", notRepo)).toEqual([])
		expect(await getCommitInfo("HEAD", notRepo)).toBe("Not a git repository")
		expect(await getWorkingState(notRepo)).toBe("Not a git repository")
		expect(await getGitStatus(notRepo)).toBeNull()
	})

	it.each([
		["a message, ignoring case", "FIX:", [1]],
		["several messages, newest first", ":", [1, 0]],
		["a hash prefix", () => commits[0].short, [0]],
		["nothing", "no-such-commit", []],
		["an unknown hash", "deadbeef", []],
	])("searches commits by %s", async (_, query, found) => {
		const result = await searchCommits(typeof query === "function" ? query() : query, repo)

		const expected = found.map((i) => ({
			hash: commits[i].hash,
			shortHash: commits[i].short,
			subject: ["feat: first feature", "fix: second change"][i],
			author: "Ann Author",
			date: ["2024-01-05", "2024-01-06"][i],
		}))
		expect(result).toEqual(expected)
	})

	it("describes a commit: header, description, changed files and the diff", async () => {
		const info = await getCommitInfo(commits[0].hash, repo)

		expect(info).toContain(`Commit: ${commits[0].short} (${commits[0].hash})`)
		expect(info).toContain("Author: Ann Author")
		expect(info).toContain("\nMessage: feat: first feature")
		expect(info).toContain("\nDescription:\nThe longer description.")
		expect(info).toContain("\nFiles Changed:\na.txt | 1 +\n 1 file changed, 1 insertion(+)")
		expect(info).toContain("\nFull Changes:\n\ndiff --git a/a.txt b/a.txt")
		expect(info).toContain("+one")
	})

	it("reports a commit it cannot show", async () => {
		expect(await getCommitInfo("0000000", repo)).toMatch(/^Failed to get commit info: /)
	})

	it("reports a clean working directory and then its changes", async () => {
		expect(await getWorkingState(repo)).toBe("No changes in working directory")

		await fs.writeFile(path.join(repo, "a.txt"), "one changed\n")

		const state = await getWorkingState(repo)
		expect(state).toMatch(/^Working directory changes:\n\n M a\.txt\n/)
		expect(state).toContain("-one\n+one changed")
	})

	it.each([
		[20, ["## main", " M a.txt", " M b.txt", "?? c.txt"]],
		[2, ["## main", " M a.txt", " M b.txt", "... 1 more files"]],
		[0, ["## main"]],
	])("shows the status with at most %i files", async (maxFiles, lines) => {
		await fs.writeFile(path.join(repo, "a.txt"), "x\n")
		await fs.writeFile(path.join(repo, "b.txt"), "y\n")
		await fs.writeFile(path.join(repo, "c.txt"), "z\n")

		expect(await getGitStatus(repo, maxFiles)).toBe(lines.join("\n"))
	})
})

describe("getGitRepositoryInfo", () => {
	let workspace: string

	beforeEach(async () => {
		workspace = await fs.mkdtemp(path.join(os.tmpdir(), "git-info-spec-"))
	})

	afterEach(async () => {
		await fs.rm(workspace, { recursive: true, force: true })
	})

	async function gitDir(files: Record<string, string>) {
		await fs.mkdir(path.join(workspace, ".git"))
		for (const [name, content] of Object.entries(files)) {
			await fs.writeFile(path.join(workspace, ".git", name), content)
		}
	}

	it("is empty outside a repository", async () => {
		expect(await getGitRepositoryInfo(workspace)).toEqual({})
	})

	it.each([
		[
			"the remote URL, without credentials and as HTTPS, and the configured branch",
			{
				config: '[remote "origin"]\n\turl = https://me:secret@github.com/acme/tool.git\n[branch "develop"]\n',
				HEAD: "ref: refs/heads/main\n",
			},
			{
				repositoryUrl: "https://github.com/acme/tool.git",
				repositoryName: "acme/tool",
				defaultBranch: "develop",
			},
		],
		[
			"an SSH remote as HTTPS, and the branch from HEAD",
			{ config: '[remote "origin"]\n\turl = git@github.com:acme/tool.git\n', HEAD: "ref: refs/heads/main\n" },
			{ repositoryUrl: "https://github.com/acme/tool.git", repositoryName: "acme/tool", defaultBranch: "main" },
		],
		[
			"no URL in the config",
			{ config: "[core]\n\tbare = false\n", HEAD: "ref: refs/heads/main\n" },
			{ defaultBranch: "main" },
		],
		["no config at all", { HEAD: "ref: refs/heads/topic\n" }, { defaultBranch: "topic" }],
		["neither config nor HEAD", {}, {}],
	])("reads %s", async (_, files, expected) => {
		await gitDir(files)

		expect(await getGitRepositoryInfo(workspace)).toEqual(expected)
	})

	it("reads the first workspace folder, or nothing without one", async () => {
		await gitDir({ HEAD: "ref: refs/heads/main\n" })
		const folders = vi.spyOn(vscode.workspace, "workspaceFolders", "get")

		folders.mockReturnValue([])
		expect(await getWorkspaceGitInfo()).toEqual({})
		folders.mockReturnValue([{ uri: { fsPath: workspace } }] as any)
		expect(await getWorkspaceGitInfo()).toEqual({ defaultBranch: "main" })
	})
})

describe("git URLs", () => {
	const HTTPS = "https://github.com/krzychdre/Tumble-Code.git"

	it.each([
		[HTTPS, HTTPS],
		["git@github.com:krzychdre/Tumble-Code.git", HTTPS],
		["ssh://git@github.com/krzychdre/Tumble-Code.git", HTTPS],
		["ssh://github.com/krzychdre/Tumble-Code.git", HTTPS],
		["not-a-valid-url", "not-a-valid-url"],
	])("convertGitUrlToHttps(%j) is %j", (url, expected) => {
		expect(convertGitUrlToHttps(url)).toBe(expected)
	})

	it.each([
		["https://username:password@github.com/krzychdre/Tumble-Code.git", HTTPS],
		[`https://oauth2:ghp_${"a".repeat(36)}@github.com/krzychdre/Tumble-Code.git`, HTTPS],
		["git@github.com:krzychdre/Tumble-Code.git", "git@github.com:krzychdre/Tumble-Code.git"],
		["ssh://git@github.com/krzychdre/Tumble-Code.git", "ssh://git@github.com/krzychdre/Tumble-Code.git"],
		[`http://ci:${"ab12".repeat(10)}@host/repo.git`, "http://ci@host/repo.git"],
		["not-a-valid-url", "not-a-valid-url"],
	])("sanitizeGitUrl(%j) is %j", (url, expected) => {
		expect(sanitizeGitUrl(url)).toBe(expected)
	})

	it.each([
		[HTTPS, "krzychdre/Tumble-Code"],
		["https://github.com/krzychdre/Tumble-Code", "krzychdre/Tumble-Code"],
		["https://username:password@github.com/krzychdre/Tumble-Code.git", "krzychdre/Tumble-Code"],
		["git@github.com:krzychdre/Tumble-Code.git", "krzychdre/Tumble-Code"],
		["ssh://git@github.com/krzychdre/Tumble-Code.git", "krzychdre/Tumble-Code"],
		["not-a-valid-git-url", ""],
	])("extractRepositoryName(%j) is %j", (url, expected) => {
		expect(extractRepositoryName(url)).toBe(expected)
	})
})
