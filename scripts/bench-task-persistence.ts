/**
 * P8 measurement (ai_plans/2026-09-28_p8-measurement.md): what does the whole-file
 * rewrite of ui_messages.json / api_conversation_history.json cost per save and per task?
 *
 * Read-only on the real task folders. Writes only into --scratch (use a directory on the
 * same disk as VS Code's globalStorage, not tmpfs: fsync on tmpfs is free).
 *
 *   pnpm exec tsx scripts/bench-task-persistence.ts \
 *     --inputs /tmp/p8-inputs --scratch ~/.cache/p8-bench \
 *     --replay /tmp/p8-inputs/longest-api_conversation_history.json \
 *     --tasks ~/.config/Code/User/globalStorage/qub-it.tumble-code/tasks
 *
 * Sections:
 *   A. per-file cost on real payloads: the real safeWriteJson (lock + stream + fsync + rename),
 *      the synchronous parts on the extension host thread (structuredClone, the taskMetadata
 *      metrics pass, JSON.stringify for comparison), the longest event-loop stall during the
 *      write, and a one-line append+fsync (what a JSONL log would do instead).
 *   B. replay of one real long task: the cost of every api history prefix (one save per push),
 *      measured in full (every prefix cloned and written); a + b * bytes is also fitted on sampled prefixes.
 *   C. synthetic N = 500 / 1000 / 2000 messages from the same fit.
 *   D. how many ui_messages.json writes the CORE-R7 coalescer (1 s idle, 3 s max wait, flush on
 *      asks) lets through, simulated on the real message timestamps of every task.
 */
import * as fs from "fs"
import * as fsp from "fs/promises"
import * as path from "path"
import { performance } from "perf_hooks"

import { safeWriteJson } from "../packages/core/src/fs/safeWriteJson"
import { consolidateApiRequests, consolidateCommands, consolidateTokenUsage } from "../packages/core/src/browser"

type Json = unknown[]

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`)
	return i >= 0 ? process.argv[i + 1] : undefined
}

function median(v: number[]): number {
	const s = [...v].sort((a, b) => a - b)
	return s[Math.floor(s.length / 2)]
}

function round(n: number, d = 2): number {
	const f = 10 ** d
	return Math.round(n * f) / f
}

/** Longest gap between 1 ms interval ticks while `fn` runs: how long the thread was blocked. */
async function withStallProbe<T>(fn: () => Promise<T>): Promise<{ result: T; maxStallMs: number }> {
	let last = performance.now()
	let maxStallMs = 0
	const timer = setInterval(() => {
		const now = performance.now()
		maxStallMs = Math.max(maxStallMs, now - last - 1)
		last = now
	}, 1)
	// Let the first tick establish the baseline.
	await new Promise((r) => setTimeout(r, 5))
	last = performance.now()
	const result = await fn()
	await new Promise((r) => setTimeout(r, 2))
	clearInterval(timer)
	return { result, maxStallMs: Math.max(0, maxStallMs) }
}

function timeSync(fn: () => unknown, reps: number): number {
	const t: number[] = []
	for (let i = 0; i < reps; i++) {
		const s = performance.now()
		fn()
		t.push(performance.now() - s)
	}
	return median(t)
}

async function timeSafeWrite(file: string, data: Json, reps: number) {
	const times: number[] = []
	const stalls: number[] = []
	for (let i = 0; i < reps; i++) {
		const { result, maxStallMs } = await withStallProbe(async () => {
			const s = performance.now()
			await safeWriteJson(file, data)
			return performance.now() - s
		})
		times.push(result)
		stalls.push(maxStallMs)
	}
	return { ms: median(times), maxMs: Math.max(...times), stallMs: median(stalls) }
}

/** What an append-only log would do per save: append one line and fsync. */
async function timeAppend(file: string, line: string, reps: number): Promise<number> {
	const times: number[] = []
	for (let i = 0; i < reps; i++) {
		const s = performance.now()
		const h = await fsp.open(file, "a")
		try {
			await h.write(line + "\n")
			await h.sync()
		} finally {
			await h.close()
		}
		times.push(performance.now() - s)
	}
	return median(times)
}

function metricsPass(messages: any[]): void {
	consolidateTokenUsage(consolidateApiRequests(consolidateCommands(messages.slice(1))))
}

async function sectionA(inputs: string, scratch: string) {
	console.log("\n## A. per-save cost on real payloads")
	console.log(
		"file | bytes | msgs | safeWriteJson median ms | max ms | stall ms (median) | structuredClone ms | JSON.stringify ms | metrics pass ms | append+fsync ms",
	)
	for (const name of fs
		.readdirSync(inputs)
		.filter((f) => /^(ui|api)-p\d+\.json$/.test(f))
		.sort()) {
		const raw = fs.readFileSync(path.join(inputs, name), "utf8")
		const data = JSON.parse(raw) as any[]
		const bytes = Buffer.byteLength(raw)
		const reps = bytes > 3_000_000 ? 7 : 15
		const target = path.join(scratch, name)
		await safeWriteJson(target, data) // warm-up (creates the file, JIT)
		const w = await timeSafeWrite(target, data, reps)
		const clone = timeSync(() => structuredClone(data), reps)
		const stringify = timeSync(() => JSON.stringify(data), reps)
		const metrics = name.startsWith("ui") ? round(timeSync(() => metricsPass(data), reps)) : "-"
		const lastLine = JSON.stringify(data[data.length - 1])
		const append = await timeAppend(path.join(scratch, `${name}.jsonl`), lastLine, reps)
		console.log(
			[
				name,
				bytes,
				data.length,
				round(w.ms),
				round(w.maxMs),
				round(w.stallMs),
				round(clone),
				round(stringify),
				metrics,
				round(append),
			].join(" | "),
		)
	}
}

/** Least squares fit of y = a + b * x. */
function fit(xs: number[], ys: number[]) {
	const n = xs.length
	const mx = xs.reduce((a, b) => a + b) / n
	const my = ys.reduce((a, b) => a + b) / n
	let sxy = 0
	let sxx = 0
	let syy = 0
	for (let i = 0; i < n; i++) {
		sxy += (xs[i] - mx) * (ys[i] - my)
		sxx += (xs[i] - mx) ** 2
		syy += (ys[i] - my) ** 2
	}
	const b = sxy / sxx
	return { a: my - b * mx, b, r2: (sxy * sxy) / (sxx * syy) }
}

async function sectionB(replay: string, scratch: string) {
	console.log("\n## B. replay of a real long task (one api history save per push)")
	const history = JSON.parse(fs.readFileSync(replay, "utf8")) as any[]
	const lineBytes = history.map((m) => Buffer.byteLength(JSON.stringify(m)) + 1)
	const prefixBytes: number[] = []
	let acc = 1
	for (const b of lineBytes) prefixBytes.push((acc += b))
	const samples = 16
	const xs: number[] = []
	const writeYs: number[] = []
	const cloneYs: number[] = []
	const target = path.join(scratch, "replay.json")
	for (let s = 1; s <= samples; s++) {
		const k = Math.max(1, Math.round((s / samples) * history.length))
		const prefix = history.slice(0, k)
		await safeWriteJson(target, prefix)
		const w = await timeSafeWrite(target, prefix, 5)
		xs.push(prefixBytes[k - 1])
		writeYs.push(w.ms)
		cloneYs.push(timeSync(() => structuredClone(prefix), 5))
	}
	const wf = fit(xs, writeYs)
	const cf = fit(xs, cloneYs)
	console.log(`messages=${history.length} final bytes=${prefixBytes[prefixBytes.length - 1]}`)
	console.log(`safeWriteJson ms = ${round(wf.a)} + ${round(wf.b * 1e6, 3)} * MB  (r2=${round(wf.r2, 3)})`)
	console.log(`structuredClone ms = ${round(cf.a)} + ${round(cf.b * 1e6, 3)} * MB  (r2=${round(cf.r2, 3)})`)
	const appendMs = await timeAppend(
		path.join(scratch, "replay.jsonl"),
		JSON.stringify(history[history.length - 1]),
		15,
	)
	// The full replay, measured rather than fitted: every prefix is cloned and written once,
	// exactly as saveApiConversationHistory does after each push.
	let totalWrite = 0
	let totalClone = 0
	let maxStall = 0
	for (let k = 1; k <= history.length; k++) {
		const prefix = history.slice(0, k)
		const c0 = performance.now()
		const copy = structuredClone(prefix)
		totalClone += performance.now() - c0
		const { result, maxStallMs } = await withStallProbe(async () => {
			const w0 = performance.now()
			await safeWriteJson(target, copy)
			return performance.now() - w0
		})
		totalWrite += result
		maxStall = Math.max(maxStall, maxStallMs)
	}
	const totalBytes = prefixBytes.reduce((a, b) => a + b, 0)
	console.log(
		`whole-file rewrites over the task: ${history.length} saves, ${round(totalBytes / 1e9, 3)} GB written, ` +
			`${round(totalWrite / 1000)} s of write time, ${round(totalClone / 1000)} s of structuredClone (event loop), longest stall inside a write ${round(maxStall)} ms`,
	)
	console.log(`append-only instead: ${round((history.length * appendMs) / 1000)} s (${round(appendMs)} ms per line)`)
	return { wf, cf, appendMs, meanLine: lineBytes.reduce((a, b) => a + b) / lineBytes.length }
}

function sectionC(model: Awaited<ReturnType<typeof sectionB>>) {
	console.log(`\n## C. synthetic N messages, mean line ${Math.round(model.meanLine)} bytes (from the replayed task)`)
	console.log("N | final MB | rewrite total s | clone total s | last save ms | append total s")
	for (const n of [500, 1000, 2000]) {
		let write = 0
		let clone = 0
		let last = 0
		for (let k = 1; k <= n; k++) {
			const x = k * model.meanLine
			last = model.wf.a + model.wf.b * x
			write += last
			clone += model.cf.a + model.cf.b * x
		}
		console.log(
			[
				n,
				round((n * model.meanLine) / 1e6),
				round(write / 1000),
				round(clone / 1000),
				round(last),
				round((n * model.appendMs) / 1000),
			].join(" | "),
		)
	}
}

/** CORE-R7 coalescer on real timestamps: calls at each message ts, 1 s idle, 3 s max wait, asks flush. */
function sectionD(tasksRoot: string) {
	console.log("\n## D. ui_messages.json writes per task, coalescer simulated on real timestamps")
	const perTask: { msgs: number; writes: number }[] = []
	for (const id of fs.readdirSync(tasksRoot)) {
		const file = path.join(tasksRoot, id, "ui_messages.json")
		if (!fs.existsSync(file)) continue
		let msgs: any[]
		try {
			msgs = JSON.parse(fs.readFileSync(file, "utf8"))
		} catch {
			continue
		}
		if (!Array.isArray(msgs) || msgs.length === 0) continue
		let writes = 1 // the first write is immediate
		let pendingSince: number | undefined
		let lastCall = 0
		for (const m of msgs.slice(1)) {
			const ts = m.ts as number
			if (pendingSince !== undefined && (ts - lastCall >= 1000 || ts - pendingSince >= 3000)) {
				writes++
				pendingSince = undefined
			}
			if (m.type === "ask" && m.ask !== "command_output") {
				// A blocking ask flushes (auto-approved asks do not; this is the upper bound).
				writes++
				pendingSince = undefined
			} else if (pendingSince === undefined) {
				pendingSince = ts
			}
			lastCall = ts
		}
		if (pendingSince !== undefined) writes++
		perTask.push({ msgs: msgs.length, writes })
	}
	const pct = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.round((p / 100) * (v.length - 1))]
	const w = perTask.map((t) => t.writes)
	const m = perTask.map((t) => t.msgs)
	console.log(`tasks=${perTask.length}`)
	console.log(`messages per task p50=${pct(m, 50)} p90=${pct(m, 90)} p99=${pct(m, 99)} max=${Math.max(...m)}`)
	console.log(`writes per task   p50=${pct(w, 50)} p90=${pct(w, 90)} p99=${pct(w, 99)} max=${Math.max(...w)}`)
	const ratio = w.reduce((a, b) => a + b) / m.reduce((a, b) => a + b)
	console.log(`writes / messages overall = ${round(ratio, 3)}`)
}

async function main() {
	const inputs = arg("inputs")
	const scratch = arg("scratch")
	const replay = arg("replay")
	const tasks = arg("tasks")
	if (!scratch) throw new Error("--scratch <dir> is required")
	await fsp.mkdir(scratch, { recursive: true })
	if (inputs) await sectionA(inputs, scratch)
	if (replay) sectionC(await sectionB(replay, scratch))
	if (tasks) sectionD(tasks)
	await fsp.rm(scratch, { recursive: true, force: true })
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
