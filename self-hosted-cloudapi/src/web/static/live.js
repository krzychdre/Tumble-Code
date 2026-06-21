/*
 * Live remote-control controller for an owned Tumble Code task.
 *
 * Loaded only on the owner's task page (never on /shared). Connects to the
 * backend socket.io relay with the browser session cookie, joins the task room,
 * appends relayed `message` events to the conversation already rendered by
 * render.js, and drives the task by emitting `task:command` events. All traffic
 * is browser ↔ backend ↔ extension — there is no direct link to VS Code.
 *
 * Protocol mirrors packages/types/src/cloud.ts (TaskSocketEvents / TaskBridge*).
 */
;(function () {
	"use strict"

	var cfgEl = document.getElementById("live-config")
	if (!cfgEl || typeof io === "undefined") return

	var cfg
	try {
		cfg = JSON.parse(cfgEl.textContent || "{}")
	} catch (e) {
		return
	}
	if (!cfg.taskId) return

	var taskId = cfg.taskId
	var bridgePath = cfg.bridgePath || "/bridge/socket.io"

	// --- DOM handles ---------------------------------------------------------
	var els = {
		status: document.getElementById("live-status"),
		activity: document.getElementById("live-activity"),
		tokensIn: document.getElementById("hdr-tokens-in"),
		tokensOut: document.getElementById("hdr-tokens-out"),
		context: document.getElementById("hdr-context"),
		mode: document.getElementById("hdr-mode"),
		cost: document.getElementById("hdr-cost"),
		input: document.getElementById("chat-input"),
		send: document.getElementById("btn-send"),
		stop: document.getElementById("btn-stop"),
		resume: document.getElementById("btn-resume"),
		autoEnabled: document.getElementById("auto-enabled"),
		autoMode: document.getElementById("auto-mode"),
		controls: document.getElementById("live-controls"),
	}
	var toggles = {}
	;["ReadOnly", "Write", "Execute", "Mcp", "ModeSwitch", "Subtasks"].forEach(function (k) {
		toggles[k] = document.getElementById("auto-" + k)
	})

	// --- helpers -------------------------------------------------------------
	// Compact, human-readable token counts: 1 000 000 → "1M", 96 941 → "96.9k".
	// Used for tokens in/out and context; cost has its own formatter.
	function fmt(n) {
		if (n == null) return "—"
		var num = Number(n)
		if (!isFinite(num)) return "—"
		var abs = Math.abs(num)
		var units = [
			{ v: 1e9, s: "B" },
			{ v: 1e6, s: "M" },
			{ v: 1e3, s: "k" },
		]
		for (var i = 0; i < units.length; i++) {
			if (abs >= units[i].v) {
				// One decimal, but drop a trailing ".0" so 1 000 000 → "1M".
				return (num / units[i].v).toFixed(1).replace(/\.0$/, "") + units[i].s
			}
		}
		return String(num)
	}

	function setStatus(text, cls) {
		if (!els.status) return
		els.status.textContent = text
		els.status.className = "live-status " + (cls || "")
	}

	function setControlsEnabled(online) {
		if (els.controls) els.controls.classList.toggle("offline", !online)
		;[els.send, els.stop, els.input, els.autoEnabled, els.autoMode].forEach(function (el) {
			if (el) el.disabled = !online
		})
		Object.keys(toggles).forEach(function (k) {
			if (toggles[k]) toggles[k].disabled = !online
		})
		// Resume stays available when offline so the user can reopen the task.
		if (els.resume) els.resume.disabled = false
	}

	// --- socket --------------------------------------------------------------
	var socket = io(window.location.origin, {
		path: bridgePath,
		withCredentials: true,
		transports: ["websocket", "polling"],
	})

	var convo = null
	function getConvo() {
		if (!convo) convo = window.__tumbleConversation || null
		return convo
	}

	var lastAsk = null // currentAsk from the most recent instanceState
	var isRunning = false
	// Token/cost/context are derived from the persisted conversation so a finished
	// or offline task still shows its totals (no live instanceState ever arrives
	// for it). A live instanceState, when one does arrive, is authoritative and
	// takes over via haveLiveTokens. contextWindow is live-only.
	var haveLiveTokens = false
	var lastContextWindow = null

	function applyMetrics() {
		if (haveLiveTokens) return // live instanceState owns these while running
		var c = getConvo()
		if (!c || !c.getMetrics) return
		var mm = c.getMetrics()
		if (els.tokensIn) els.tokensIn.textContent = fmt(mm.totalTokensIn)
		if (els.tokensOut) els.tokensOut.textContent = fmt(mm.totalTokensOut)
		if (els.cost) els.cost.textContent = mm.totalCost > 0 ? "$" + Number(mm.totalCost).toFixed(4) : "—"
		if (els.context) {
			els.context.textContent = mm.contextTokens
				? fmt(mm.contextTokens) + (lastContextWindow ? " / " + fmt(lastContextWindow) : "")
				: "—"
		}
	}

	// Single source of truth for the Stop⇄Resume toggle. The task is "running"
	// only while it is actively streaming or blocked on an interactive approval
	// (the extension derives this from taskStatus). Anything else — idle,
	// resumable, completed, or offline — shows Resume, never Stop.
	function setRunning(running) {
		isRunning = !!running
		if (els.stop) els.stop.style.display = isRunning ? "" : "none"
		if (els.resume) els.resume.style.display = isRunning ? "none" : ""
		refreshActivity()
	}

	// Surface what the task is doing right now (api / tool / thinking), like the
	// VS Code webview. Prefer the live streaming row; fall back to isRunning.
	function refreshActivity() {
		if (!els.activity) return
		var c = getConvo()
		var label = c && c.getActivity ? c.getActivity() : null
		if (!label && isRunning) label = "Working…"
		if (label) {
			els.activity.textContent = label
			els.activity.style.display = ""
			els.activity.classList.add("busy")
		} else {
			els.activity.textContent = ""
			els.activity.style.display = "none"
			els.activity.classList.remove("busy")
		}
	}

	socket.on("connect", function () {
		socket.emit("task:join", { taskId: taskId }, function (res) {
			if (!res || !res.success) {
				setStatus("Cannot control this task", "offline")
				setControlsEnabled(false)
				return
			}
			var online = !!res.instanceOnline
			setStatus(online ? "Live" : "Extension offline", online ? "live" : "offline")
			setControlsEnabled(online)
			if (!online) setRunning(false)
			if (res.instance) applyInstanceState(res.instance)
		})
	})

	socket.on("disconnect", function () {
		setStatus("Disconnected", "offline")
		setControlsEnabled(false)
		setRunning(false)
	})

	socket.on("connect_error", function () {
		setStatus("Connection error", "offline")
	})

	socket.on("task:relayed_event", function (data) {
		if (!data || typeof data !== "object") return
		if (data.type === "message" && data.message) {
			var c = getConvo()
			if (c) c.upsert(data.message)
			refreshActivity()
			applyMetrics()
		} else if (data.type === "instanceState") {
			applyInstanceState(data)
		}
	})

	// --- render instance state into the header + controls --------------------
	function applyInstanceState(s) {
		if (!s) return
		if (s.contextWindow) lastContextWindow = s.contextWindow
		var tu = s.tokenUsage || {}
		// A snapshot carrying token data means the task is live — let it own the
		// header totals from here on, over the message-derived baseline.
		if (tu.totalTokensIn != null || tu.totalTokensOut != null || tu.totalCost != null) {
			haveLiveTokens = true
		}
		if (els.tokensIn) els.tokensIn.textContent = fmt(tu.totalTokensIn)
		if (els.tokensOut) els.tokensOut.textContent = fmt(tu.totalTokensOut)
		if (els.cost && tu.totalCost != null) els.cost.textContent = "$" + Number(tu.totalCost).toFixed(4)
		var ctx = s.contextTokens != null ? s.contextTokens : tu.contextTokens
		if (els.context) {
			els.context.textContent =
				ctx != null ? fmt(ctx) + (s.contextWindow ? " / " + fmt(s.contextWindow) : "") : "—"
		}
		if (els.mode && s.mode) els.mode.textContent = s.mode

		if (s.isRunning != null) {
			setRunning(s.isRunning)
		}
		if (s.autoApproval) applyAutoApproval(s.autoApproval)
		if ("currentAsk" in s) {
			lastAsk = s.currentAsk || null
			updateAskFromState(lastAsk)
		}
		refreshActivity()
	}

	var answered = {} // ask ts -> true: a stale instanceState must not re-show it

	// Drive the inline Approve/Deny on the ask's own conversation row.
	function updateAskFromState(ask) {
		var c = getConvo()
		if (!c || !c.setActiveAsk) return
		if (ask && ask.ts != null && !answered[ask.ts]) {
			c.setActiveAsk(ask.ts, {
				onApprove: function () {
					answerAsk(ask, "approved")
				},
				onDeny: function () {
					answerAsk(ask, "denied")
				},
			})
		} else {
			c.clearActiveAsk()
		}
	}

	function answerAsk(ask, decision) {
		if (ask && ask.ts != null) answered[ask.ts] = true
		sendCommand(decision === "approved" ? "approve_ask" : "deny_ask", { payload: {} })
		var c = getConvo()
		if (c && ask) c.markResolved(ask.ts, decision)
		lastAsk = null
	}

	var suppressAuto = false
	function applyAutoApproval(a) {
		suppressAuto = true
		try {
			if (els.autoEnabled && a.autoApprovalEnabled != null) els.autoEnabled.checked = !!a.autoApprovalEnabled
			if (els.autoMode && a.autoApprovalMode) els.autoMode.value = a.autoApprovalMode
			var map = {
				ReadOnly: a.alwaysAllowReadOnly,
				Write: a.alwaysAllowWrite,
				Execute: a.alwaysAllowExecute,
				Mcp: a.alwaysAllowMcp,
				ModeSwitch: a.alwaysAllowModeSwitch,
				Subtasks: a.alwaysAllowSubtasks,
			}
			Object.keys(map).forEach(function (k) {
				if (toggles[k] && map[k] != null) toggles[k].checked = !!map[k]
			})
		} finally {
			suppressAuto = false
		}
	}

	// --- command emitters ----------------------------------------------------
	function sendCommand(type, extra) {
		var payload = Object.assign({ type: type, taskId: taskId, timestamp: Date.now() }, extra || {})
		socket.emit("task:command", payload, function (res) {
			if (!res || !res.success) {
				setStatus(
					(res && res.error) === "extension offline" ? "Extension offline" : "Command failed",
					"offline",
				)
			}
		})
	}

	if (els.send) {
		els.send.addEventListener("click", function () {
			var text = ((els.input && els.input.value) || "").trim()
			if (!text) return
			sendCommand("message", { payload: { text: text } })
			if (els.input) els.input.value = ""
		})
	}
	if (els.input) {
		els.input.addEventListener("keydown", function (e) {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault()
				if (els.send) els.send.click()
			}
		})
	}
	if (els.stop)
		els.stop.addEventListener("click", function () {
			sendCommand("stop_task", {})
		})
	if (els.resume)
		els.resume.addEventListener("click", function () {
			sendCommand("resume_task", {})
		})

	function pushAutoApproval() {
		if (suppressAuto) return
		var payload = {}
		if (els.autoEnabled) payload.autoApprovalEnabled = !!els.autoEnabled.checked
		if (els.autoMode) payload.autoApprovalMode = els.autoMode.value
		var keyByName = {
			ReadOnly: "alwaysAllowReadOnly",
			Write: "alwaysAllowWrite",
			Execute: "alwaysAllowExecute",
			Mcp: "alwaysAllowMcp",
			ModeSwitch: "alwaysAllowModeSwitch",
			Subtasks: "alwaysAllowSubtasks",
		}
		Object.keys(toggles).forEach(function (k) {
			if (toggles[k]) payload[keyByName[k]] = !!toggles[k].checked
		})
		sendCommand("set_auto_approval", { payload: payload })
	}
	;[els.autoEnabled, els.autoMode].forEach(function (el) {
		if (el) el.addEventListener("change", pushAutoApproval)
	})
	Object.keys(toggles).forEach(function (k) {
		if (toggles[k]) toggles[k].addEventListener("change", pushAutoApproval)
	})

	// Initial UI state: offline and not-running until the join ack says otherwise.
	setStatus("Connecting…", "")
	setControlsEnabled(false)
	setRunning(false)

	// Baseline the header from the already-rendered history so a finished/offline
	// task shows its totals immediately, before (or without) any live snapshot.
	// render.js calls this once the conversation is mounted; also try inline in
	// case render.js already finished (readyState was not "loading").
	window.TumbleLiveInit = function (c) {
		convo = c || convo
		applyMetrics()
		refreshActivity()
	}
	applyMetrics()
})()
