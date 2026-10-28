// npx vitest run src/__tests__/taskImages.spec.ts

import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { MAX_TASK_IMAGE_BYTES, findLocalImageReferences, imageMimeType, locateTaskImage } from "../taskImages.js"

describe("findLocalImageReferences", () => {
	it("finds a reference on its own line and inline, with the target as written", () => {
		const text = [
			"Here is the chart:",
			"![Ryzyko](monitoring/pv-bateria.png)",
			"and inline ![a](./shots/a.jpg) too.",
		].join("\n")
		expect(findLocalImageReferences(text)).toEqual(["monitoring/pv-bateria.png", "./shots/a.jpg"])
	})

	it("strips angle brackets and a title", () => {
		expect(findLocalImageReferences('![x](<out/a.png> "The title")')).toEqual(["out/a.png"])
		expect(findLocalImageReferences('![x](/abs/b.webp "t")')).toEqual(["/abs/b.webp"])
	})

	it("accepts spaces between angle brackets and decodes percent escapes, as the web page asks", () => {
		expect(findLocalImageReferences("![a](<./a b.png>)")).toEqual(["./a b.png"])
		expect(findLocalImageReferences("![a](./a%20b.png)")).toEqual(["./a b.png"])
		expect(findLocalImageReferences("![a](./bad%zz.png)")).toEqual(["./bad%zz.png"])
	})

	it("leaves out a target the server would refuse as too long", () => {
		expect(findLocalImageReferences(`![a](${"x".repeat(1100)}.png)`)).toEqual([])
	})

	it("leaves out remote and embedded images", () => {
		const text = [
			"![a](https://example.com/a.png)",
			"![b](http://example.com/b.png)",
			"![c](data:image/png;base64,AAAA)",
			"![d](file:///tmp/d.png)",
			"![e](//cdn.example.com/e.png)",
		].join("\n")
		expect(findLocalImageReferences(text)).toEqual([])
	})

	it("keeps a Windows drive path and lists a repeated target once", () => {
		expect(findLocalImageReferences("![a](C:\\shots\\a.png) ![b](C:\\shots\\a.png)")).toEqual(["C:\\shots\\a.png"])
	})

	it("ignores plain links and text without images", () => {
		expect(findLocalImageReferences("[link](a.png) and no images")).toEqual([])
		expect(findLocalImageReferences("")).toEqual([])
	})
})

describe("imageMimeType", () => {
	it("maps the accepted extensions, case-insensitively", () => {
		expect(imageMimeType("a.png")).toBe("image/png")
		expect(imageMimeType("a.JPG")).toBe("image/jpeg")
		expect(imageMimeType("a.jpeg")).toBe("image/jpeg")
		expect(imageMimeType("a.gif")).toBe("image/gif")
		expect(imageMimeType("a.webp")).toBe("image/webp")
	})

	it("refuses anything else, SVG included", () => {
		expect(imageMimeType("a.svg")).toBeUndefined()
		expect(imageMimeType("a.txt")).toBeUndefined()
		expect(imageMimeType("noext")).toBeUndefined()
	})
})

describe("locateTaskImage", () => {
	let workspace: string

	beforeEach(async () => {
		// The real path: the located file is reported by where it really is.
		workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), "task-images-")))
		await mkdir(path.join(workspace, "monitoring"))
		await writeFile(path.join(workspace, "monitoring", "chart.png"), Buffer.from([1, 2, 3]))
	})

	afterEach(async () => {
		await rm(workspace, { recursive: true, force: true })
	})

	it("resolves a relative target against the workspace", async () => {
		const image = await locateTaskImage("monitoring/chart.png", workspace)
		expect(image).toMatchObject({
			file: path.join(workspace, "monitoring", "chart.png"),
			mime: "image/png",
			size: 3,
		})
		expect(typeof image?.mtimeMs).toBe("number")
	})

	it("takes an absolute target inside the workspace", async () => {
		const file = path.join(workspace, "monitoring", "chart.png")
		expect((await locateTaskImage(file, workspace))?.file).toBe(file)
	})

	describe("never uploads a file outside the workspace", () => {
		let outside: string

		beforeEach(async () => {
			outside = await realpath(await mkdtemp(path.join(os.tmpdir(), "task-images-outside-")))
			await writeFile(path.join(outside, "private.png"), Buffer.from([1, 2, 3]))
		})

		afterEach(async () => {
			await rm(outside, { recursive: true, force: true })
		})

		it("refuses an absolute path elsewhere", async () => {
			expect(await locateTaskImage(path.join(outside, "private.png"), workspace)).toBeUndefined()
		})

		it("refuses a relative path that climbs out", async () => {
			const climbing = path.relative(workspace, path.join(outside, "private.png"))
			expect(climbing.startsWith("..")).toBe(true)
			expect(await locateTaskImage(climbing, workspace)).toBeUndefined()
		})

		it.skipIf(process.platform === "win32")("refuses a link in the workspace that leads out of it", async () => {
			await symlink(path.join(outside, "private.png"), path.join(workspace, "innocent.png"))
			await symlink(outside, path.join(workspace, "linked-dir"))

			expect(await locateTaskImage("innocent.png", workspace)).toBeUndefined()
			expect(await locateTaskImage("linked-dir/private.png", workspace)).toBeUndefined()
		})

		it("refuses any target when there is no workspace", async () => {
			expect(await locateTaskImage(path.join(outside, "private.png"), undefined)).toBeUndefined()
		})
	})

	it("skips missing files, directories and other types", async () => {
		await mkdir(path.join(workspace, "dir.png"))
		await writeFile(path.join(workspace, "notes.txt"), "x")
		expect(await locateTaskImage("missing.png", workspace)).toBeUndefined()
		expect(await locateTaskImage("dir.png", workspace)).toBeUndefined()
		expect(await locateTaskImage("notes.txt", workspace)).toBeUndefined()
	})

	it("skips a file over the size limit", async () => {
		await writeFile(path.join(workspace, "big.png"), Buffer.alloc(MAX_TASK_IMAGE_BYTES + 1))
		expect(await locateTaskImage("big.png", workspace)).toBeUndefined()
	})
})
