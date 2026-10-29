import os from "os"
import path from "path"
import { RooProtectedController } from "../RooProtectedController"

describe("RooProtectedController", () => {
	const TEST_CWD = "/test/workspace"
	let controller: RooProtectedController

	beforeEach(() => {
		controller = new RooProtectedController(TEST_CWD)
	})

	describe("isWriteProtected", () => {
		it("should protect .rooignore file", () => {
			expect(controller.isWriteProtected(".rooignore")).toBe(true)
		})

		it("should protect files in .roo directory", () => {
			expect(controller.isWriteProtected(".roo/config.json")).toBe(true)
			expect(controller.isWriteProtected(".roo/settings/user.json")).toBe(true)
			expect(controller.isWriteProtected(".roo/modes/custom.json")).toBe(true)
		})

		it("should protect .rooprotected file", () => {
			expect(controller.isWriteProtected(".rooprotected")).toBe(true)
		})

		it("should protect .roomodes files", () => {
			expect(controller.isWriteProtected(".roomodes")).toBe(true)
		})

		it("should protect .roorules* files", () => {
			expect(controller.isWriteProtected(".roorules")).toBe(true)
			expect(controller.isWriteProtected(".roorules.md")).toBe(true)
		})

		it("should protect .clinerules* files", () => {
			expect(controller.isWriteProtected(".clinerules")).toBe(true)
			expect(controller.isWriteProtected(".clinerules.md")).toBe(true)
		})

		it("should protect files in .vscode directory", () => {
			expect(controller.isWriteProtected(".vscode/settings.json")).toBe(true)
			expect(controller.isWriteProtected(".vscode/launch.json")).toBe(true)
			expect(controller.isWriteProtected(".vscode/tasks.json")).toBe(true)
		})

		it("should protect .code-workspace files", () => {
			expect(controller.isWriteProtected("myproject.code-workspace")).toBe(true)
			expect(controller.isWriteProtected("pentest.code-workspace")).toBe(true)
			expect(controller.isWriteProtected(".code-workspace")).toBe(true)
			expect(controller.isWriteProtected("folder/workspace.code-workspace")).toBe(true)
		})

		it("should protect AGENTS.md file", () => {
			expect(controller.isWriteProtected("AGENTS.md")).toBe(true)
		})

		it("should protect AGENT.md file", () => {
			expect(controller.isWriteProtected("AGENT.md")).toBe(true)
		})

		it("should not protect other files starting with .roo", () => {
			expect(controller.isWriteProtected(".roosettings")).toBe(false)
			expect(controller.isWriteProtected(".rooconfig")).toBe(false)
		})

		it("should not protect regular files", () => {
			expect(controller.isWriteProtected("src/index.ts")).toBe(false)
			expect(controller.isWriteProtected("package.json")).toBe(false)
			expect(controller.isWriteProtected("README.md")).toBe(false)
		})

		it("should not protect files that contain 'roo' but don't start with .roo", () => {
			expect(controller.isWriteProtected("src/roo-utils.ts")).toBe(false)
			expect(controller.isWriteProtected("config/roo.config.js")).toBe(false)
		})

		it("should handle nested paths correctly", () => {
			expect(controller.isWriteProtected(".roo/config.json")).toBe(true) // .roo/** matches at root
			expect(controller.isWriteProtected("nested/.rooignore")).toBe(true) // .rooignore matches anywhere by default
			expect(controller.isWriteProtected("nested/.roomodes")).toBe(true) // .roomodes matches anywhere by default
			expect(controller.isWriteProtected("nested/.roorules.md")).toBe(true) // .roorules* matches anywhere by default
		})

		it("should handle absolute paths by converting to relative", () => {
			const absolutePath = path.join(TEST_CWD, ".rooignore")
			expect(controller.isWriteProtected(absolutePath)).toBe(true)
		})

		it("should handle paths with different separators", () => {
			expect(controller.isWriteProtected(".roo\\config.json")).toBe(true)
			expect(controller.isWriteProtected(".roo/config.json")).toBe(true)
		})

		it("should not throw for absolute paths outside cwd", () => {
			expect(controller.isWriteProtected("/tmp/comment-2-pr63.json")).toBe(false)
			expect(controller.isWriteProtected("/etc/passwd")).toBe(false)
		})
	})

	describe("getProtectedFiles", () => {
		it("should return set of protected files from a list", () => {
			const files = ["src/index.ts", ".rooignore", "package.json", ".roo/config.json", "README.md"]

			const protectedFiles = controller.getProtectedFiles(files)

			expect(protectedFiles).toEqual(new Set([".rooignore", ".roo/config.json"]))
		})

		it("should return empty set when no files are protected", () => {
			const files = ["src/index.ts", "package.json", "README.md"]

			const protectedFiles = controller.getProtectedFiles(files)

			expect(protectedFiles).toEqual(new Set())
		})
	})

	describe("annotatePathsWithProtection", () => {
		it("should annotate paths with protection status", () => {
			const files = ["src/index.ts", ".rooignore", ".roo/config.json", "package.json"]

			const annotated = controller.annotatePathsWithProtection(files)

			expect(annotated).toEqual([
				{ path: "src/index.ts", isProtected: false },
				{ path: ".rooignore", isProtected: true },
				{ path: ".roo/config.json", isProtected: true },
				{ path: "package.json", isProtected: false },
			])
		})
	})

	describe("getProtectionMessage", () => {
		it("should return appropriate protection message", () => {
			const message = controller.getProtectionMessage()
			expect(message).toBe("This is a Roo configuration file and requires approval for modifications")
		})
	})

	describe("getInstructions", () => {
		it("should return formatted instructions about protected files", () => {
			const instructions = controller.getInstructions()

			expect(instructions).toContain("# Protected Files")
			expect(instructions).toContain("write-protected")
			expect(instructions).toContain(".rooignore")
			expect(instructions).toContain(".roo/**")
			expect(instructions).toContain("\u{1F6E1}") // Shield symbol
		})
	})

	describe("getProtectedPatterns", () => {
		it("should return the list of protected patterns", () => {
			const patterns = RooProtectedController.getProtectedPatterns()

			expect(patterns).toEqual([
				".rooignore",
				".roomodes",
				".roorules*",
				".clinerules*",
				".roo/**",
				".vscode/**",
				"*.code-workspace",
				".rooprotected",
				"AGENTS.md",
				"AGENT.md",
			])
		})
	})
})

describe("RooProtectedController beyond the cwd", () => {
	const workspace = path.resolve("/work/repo")
	const home = path.resolve("/home/ann")
	const userDir = path.resolve("/home/ann/.config/Code/User")
	// A task working in a subfolder of the workspace.
	const controller = new RooProtectedController(path.join(workspace, "packages/app"), {
		roots: [workspace, home],
		protectedDirectories: [userDir],
	})

	it.each([
		["the workspace's .roo from a subfolder", "../../.roo/mcp.json"],
		["the workspace's .rooignore from a subfolder", "../../.rooignore"],
		["the workspace's .vscode settings", "../../.vscode/settings.json"],
		["the global MCP file of the CLI", path.join(home, ".roo/mcp.json")],
		["a global custom tool", path.join(home, ".roo/tools/tool.ts")],
		["VS Code's user settings", path.join(userDir, "settings.json")],
		["an extension's global storage", path.join(userDir, "globalStorage/x.y/settings/mcp_settings.json")],
	])("protects %s", (_label, filePath) => {
		expect(controller.isWriteProtected(filePath)).toBe(true)
	})

	it.each([
		["a source file of the workspace", "../../src/index.ts"],
		["a file elsewhere", "/tmp/out.txt"],
		["a file in the home directory", path.join(home, "notes.txt")],
	])("leaves %s writable", (_label, filePath) => {
		expect(controller.isWriteProtected(filePath)).toBe(false)
	})
})

describe("RooProtectedController through a symlink", () => {
	it("protects the target of a link that leads into .roo", async () => {
		const fs = await import("fs/promises")
		const os = await import("os")
		const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "protect-spec-")))
		try {
			await fs.mkdir(path.join(root, ".roo"))
			await fs.symlink(path.join(root, ".roo"), path.join(root, "docs"), "dir")
			const controller = new RooProtectedController(root)

			expect(controller.isWriteProtected("docs/mcp.json")).toBe(true)
			expect(controller.isWriteProtected("docs-not-a-link/mcp.json")).toBe(false)
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})
})

describe("RooProtectedController.isCommandWriteProtected", () => {
	const controller = new RooProtectedController("/test/workspace")

	it.each([
		"cat > .roo/mcp.json <<'X'\n{}\nX",
		"echo '{}' >> .roo/mcp.json",
		"printf x 1>.rooignore",
		"tee .roo/mcp.json < config.json",
		"cp evil.json .roo/mcp.json",
		"sed -i s/a/b/ .vscode/settings.json",
		"python3 write.py .roo/mcp.json",
		"sh -c 'cat > .roo/mcp.json'",
		"sudo cp x AGENTS.md",
		"git status && mv a .roomodes",
	])("finds a write to a protected file in %j", (command) => {
		expect(controller.isCommandWriteProtected(command)).toBe(true)
	})

	it.each([
		["a write relative to the directory the command runs in", "echo '{}' > mcp.json", ".roo"],
		["a write relative to an absolute working directory", "cp evil.json settings.json", "/test/workspace/.vscode"],
		["a write after a cd in the chain", "cd .roo && echo '{}' > mcp.json", undefined],
		["a write after a cd inside a wrapper", "sh -c 'cd .vscode && tee settings.json'", undefined],
		["a write climbing back from a subdirectory", "echo x > ../AGENTS.md", "src"],
	])("finds %s", (_label, command, workingDirectory) => {
		expect(controller.isCommandWriteProtected(command, workingDirectory)).toBe(true)
	})

	it("judges the same file name by where the command runs", () => {
		expect(controller.isCommandWriteProtected("echo x > mcp.json", "src")).toBe(false)
		expect(controller.isCommandWriteProtected("cd src && echo x > settings.json")).toBe(false)
	})

	it.each(["cat AGENTS.md", "grep -n mode .roomodes", "sed -n 1,5p .roo/rules.md", "npm test > out.log", "ls .roo"])(
		"finds no write in %j",
		(command) => {
			expect(controller.isCommandWriteProtected(command)).toBe(false)
		},
	)
})

describe("RooProtectedController.isCommandWriteProtected in the home directory and in code", () => {
	const home = os.homedir()
	const controller = new RooProtectedController("/test/workspace", {
		roots: [home],
		protectedDirectories: [path.join(home, ".config/Code/User")],
	})

	it.each([
		["a redirect to ~/", "cat > ~/.roo/mcp.json <<'X'\n{}\nX"],
		["a redirect to $HOME", 'echo x > "$HOME/.roo/mcp.json"'],
		["a writer argument under ${HOME}", "cp evil.json ${HOME}/.roo/mcp.json"],
		["the global MCP settings under ~", "tee ~/.config/Code/User/globalStorage/x.y/settings/mcp_settings.json"],
		["a write after a cd to ~/", "cd ~/.roo && cat > mcp.json"],
		["a redirect to a variable", 'echo x > "$OUT"'],
		["a writer argument from a substitution", "cp evil.json $(dirname x)/mcp.json"],
		["a write after a cd to a variable", 'cd "$DIR" && echo x > mcp.json'],
		["python code naming .roo", "python3 -c \"open('.roo/mcp.json', 'w').write('{}')\""],
		[
			"node code naming VS Code's user settings",
			"node -e \"require('fs').writeFileSync(require('os').homedir() + '/.config/Code/User/settings.json', '{}')\"",
		],
		["an awk program writing into .roo", "awk 'BEGIN { print 1 > \".roo/mcp.json\" }'"],
		["an awk program only known when it runs", 'awk "$PROG" data.txt'],
	])("finds %s: %j", (_label, command) => {
		expect(controller.isCommandWriteProtected(command)).toBe(true)
	})

	it.each([
		"echo $PATH",
		'printf "%s\\n" "$HOME"',
		'[ -f "$F" ]',
		"cat ~/.roo/mcp.json",
		"echo x > ~/notes.txt",
		"python3 -c 'print(1)'",
		"node -e \"console.log(require('os').homedir())\"",
	])("finds no write in %j", (command) => {
		expect(controller.isCommandWriteProtected(command)).toBe(false)
	})
})
