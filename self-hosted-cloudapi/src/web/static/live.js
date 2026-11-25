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
		context: document.getElementById("hdr-context"),
		mode: document.getElementById("hdr-mode"),
		input: document.getElementById("chat-input"),
		send: document.getElementById("btn-send"),
		stop: document.getElementById("btn-stop"),
		resume: document.getElementById("btn-resume"),
		autoEnabled: document.getElementById("auto-enabled"),
		autoMode: document.getElementById("auto-mode"),
		controls: document.getElementById("live-controls"),
		dock: document.getElementById("ask-dock"),
		dockKind: document.getElementById("ask-dock-kind"),
		dockJump: document.getElementById("ask-dock-jump"),
		dockQuestion: document.getElementById("ask-dock-question"),
		dockDetail: document.getElementById("ask-dock-detail"),
		dockSuggestions: document.getElementById("ask-dock-suggestions"),
		dockOwn: document.getElementById("ask-dock-own"),
		dockDecide: document.getElementById("ask-dock-decide"),
		dockApprove: document.getElementById("ask-dock-approve"),
		dockDeny: document.getElementById("ask-dock-deny"),
		dockComment: document.getElementById("ask-dock-comment"),
		header: document.getElementById("detail-header"),
		state: document.getElementById("task-state"),
		headStop: document.getElementById("head-stop"),
		sumMode: document.getElementById("sum-mode"),
	}
	var composerPlaceholder = els.input ? els.input.placeholder : ""
	var toggles = {}
	;["ReadOnly", "Write", "Execute", "Mcp", "ModeSwitch", "Subtasks"].forEach(function (k) {
		toggles[k] = document.getElementById("auto-" + k)
	})

	// --- helpers -------------------------------------------------------------
	// Token counts and costs read exactly as the server rendered them
	// (static/format.js, loaded before this file).
	var fmt = window.TumbleFormat.tokens
	var fmtCost = window.TumbleFormat.cost

	// --- the spend table ------------------------------------------------------
	// This task's figures as last known, and what its stored subtasks add to
	// them. The subtasks' part is fixed at render (each subtask's own page is the
	// live one), so the run row is always this task's current figures plus it.
	var own = { tokensIn: null, tokensOut: null, cost: null }
	var subtasks = cfg.subtasks || null
	// The table's top row, which the phone's Details summary repeats.
	var topRow = subtasks ? "run" : "own"

	// A figure not known yet keeps what the server rendered.
	function setCell(id, text) {
		var el = document.getElementById(id)
		if (el && text != null) el.textContent = text
	}

	function showRow(key, s) {
		var both = s.tokensIn != null && s.tokensOut != null
		setCell("hdr-" + key + "-tokens", both ? fmt(s.tokensIn + s.tokensOut) : null)
		setCell("hdr-" + key + "-in", s.tokensIn != null ? fmt(s.tokensIn) : null)
		setCell("hdr-" + key + "-out", s.tokensOut != null ? fmt(s.tokensOut) : null)
		setCell("hdr-" + key + "-cost", s.cost != null ? fmtCost(s.cost) : null)
		if (key === topRow) {
			setCell("sum-tokens", both ? fmt(s.tokensIn + s.tokensOut) : null)
			setCell("sum-cost", s.cost != null ? fmtCost(s.cost) : null)
		}
	}

	function showSpend() {
		showRow("own", own)
		if (!subtasks) return
		function plus(a, b) {
			return a == null ? null : a + (b || 0)
		}
		showRow("run", {
			tokensIn: plus(own.tokensIn, subtasks.tokensIn),
			tokensOut: plus(own.tokensOut, subtasks.tokensOut),
			cost: plus(own.cost, subtasks.cost),
		})
	}

	function setStatus(text, cls) {
		if (!els.status) return
		els.status.textContent = text
		els.status.className = "live-status " + (cls || "")
	}

	var controlsOnline = false

	function setControlsEnabled(online) {
		if (els.controls) els.controls.classList.toggle("offline", !online)
		;[els.send, els.stop, els.headStop, els.input, els.autoEnabled, els.autoMode].forEach(function (el) {
			if (el) el.disabled = !online
		})
		Object.keys(toggles).forEach(function (k) {
			if (toggles[k]) toggles[k].disabled = !online
		})
		controlsOnline = online
		if (els.dock) {
			els.dock.querySelectorAll("button").forEach(function (b) {
				b.disabled = !online || !!(dockAsk && dockAsk.partial)
			})
		}
		// Resume stays available when offline so the user can reopen the task.
		if (els.resume) els.resume.disabled = false
		refreshState()
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
	var joined = false // the join was answered
	var isRunning = false
	var openedAtTail = false
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
		own = { tokensIn: mm.totalTokensIn, tokensOut: mm.totalTokensOut, cost: mm.totalCost }
		showSpend()
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
		if (els.stop) els.stop.hidden = !isRunning
		if (els.headStop) els.headStop.hidden = !isRunning
		if (els.resume) els.resume.hidden = isRunning
		refreshActivity()
		refreshState()
	}

	// The header's one word on the task. A pending ask the dock shows outranks
	// running: the extension reports an ask it waits on as running too.
	var STATE_LABELS = {
		connecting: "Connecting…",
		offline: "Offline",
		waiting: "Waiting for you",
		running: "Working",
		done: "Done",
		idle: "Idle",
	}
	var DONE_ASKS = { completion_result: true, resume_completed_task: true }

	function taskState() {
		if (!joined) return "connecting"
		if (!controlsOnline) return "offline"
		if (dockAsk && ASK_DOCK[dockAsk.ask].waits !== false) return "waiting"
		if (isRunning) return "running"
		if (lastAsk && DONE_ASKS[lastAsk.ask]) return "done"
		return "idle"
	}

	function refreshState() {
		if (!els.state) return
		var state = taskState()
		els.state.setAttribute("data-state", state)
		els.state.textContent = STATE_LABELS[state]
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
			els.activity.hidden = false
			els.activity.classList.add("busy")
		} else {
			els.activity.textContent = ""
			els.activity.hidden = true
			els.activity.classList.remove("busy")
		}
	}

	socket.on("connect", function () {
		socket.emit("task:join", { taskId: taskId }, function (res) {
			joined = true
			if (!res || !res.success) {
				setStatus("Cannot control this task", "offline")
				setControlsEnabled(false)
				return
			}
			var online = !!res.instanceOnline
			setStatus(online ? "Live" : "Extension offline", online ? "live" : "offline")
			setControlsEnabled(online)
			if (!online) setRunning(false)
			if (res.instance) applyInstanceState(ownSnapshot(res.instance))
		})
	})

	// The join answers with what the window running this task registered with
	// (no figures, no mode), merged with this task's last snapshot when there is
	// one; for a task no window streams it is the newest window's record. Only a
	// snapshot of this task describes this task; the
	// auto-approval settings belong to the extension, so they hold for any, and
	// the controls push all of them at once, so they must start from the truth.
	function ownSnapshot(inst) {
		if (inst.taskId === taskId) return inst
		return inst.autoApproval ? { autoApproval: inst.autoApproval } : null
	}

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
		// A figure the snapshot does not carry keeps the value already shown: a
		// snapshot with no token data says nothing about them, it does not zero them.
		if (tu.totalTokensIn != null) own.tokensIn = tu.totalTokensIn
		if (tu.totalTokensOut != null) own.tokensOut = tu.totalTokensOut
		if (tu.totalCost != null) own.cost = tu.totalCost
		showSpend()
		var ctx = s.contextTokens != null ? s.contextTokens : tu.contextTokens
		if (els.context && ctx != null) {
			els.context.textContent = fmt(ctx) + (s.contextWindow ? " / " + fmt(s.contextWindow) : "")
		}
		if (s.mode) {
			if (els.mode) els.mode.textContent = s.mode
			if (els.sumMode) els.sumMode.textContent = s.mode
		}

		if (s.isRunning != null) {
			setRunning(s.isRunning)
		}
		// A live task opens at its newest message (static/follow.js).
		if (isRunning && !openedAtTail && window.TumbleFollow) {
			openedAtTail = true
			window.TumbleFollow.toTail()
		}
		if (s.autoApproval) applyAutoApproval(s.autoApproval)
		if ("currentAsk" in s) {
			lastAsk = s.currentAsk || null
			updateAskFromState(lastAsk)
		}
		refreshActivity()
	}

	var answered = {} // ask ts -> true: a stale instanceState must not re-show it

	// --- the ask dock ---------------------------------------------------------
	// What the dock offers per ClineAsk, after the VS Code panel's buttons
	// (webview-ui useAskButtons.ts). Approve sends approve_ask, Deny deny_ask;
	// an ask missing here (completion_result, resume_task, ...) gets no dock and
	// the composer answers it as a message. A value may be a function of the ask
	// and its parsed text.
	var EDIT_TOOLS = { editedExistingFile: true, appliedDiff: true, newFileCreated: true }

	function toolApprove(ask, obj) {
		if (obj.tool === "finishTask") return "Complete subtask and keep going"
		var label = EDIT_TOOLS[obj.tool] ? "Save" : "Approve"
		return isBatch(obj) ? label + " All" : label
	}
	function toolDeny(ask, obj) {
		if (obj.tool === "finishTask") return null
		return isBatch(obj) ? "Deny All" : "Deny"
	}
	function isBatch(obj) {
		return Array.isArray(obj.batchDiffs) || Array.isArray(obj.batchFiles) || Array.isArray(obj.batchDirs)
	}
	function askText(ask) {
		return ask.text || ""
	}
	function toolDetail(ask, obj) {
		return (obj.tool || "tool") + (obj.path ? " " + obj.path : "")
	}
	function mcpDetail(ask, obj) {
		return [obj.serverName, obj.toolName || obj.uri].filter(Boolean).join(" · ")
	}

	var ASK_DOCK = {
		followup: { kind: "Question" },
		command: { kind: "Run command", prompt: "Run this command?", approve: "Run", deny: "Deny", detail: askText },
		// The command runs on and the task with it; Continue is optional, so the
		// header keeps saying Working.
		command_output: {
			kind: "Command running",
			prompt: "The command is still running.",
			approve: "Continue While Running",
			waits: false,
		},
		tool: {
			kind: "Approve tool",
			prompt: "Allow this tool call?",
			approve: toolApprove,
			deny: toolDeny,
			detail: toolDetail,
		},
		use_mcp_server: {
			kind: "Use MCP server",
			prompt: "Allow this MCP call?",
			approve: "Approve",
			deny: "Deny",
			detail: mcpDetail,
		},
		api_req_failed: {
			kind: "Request failed",
			prompt: "The API request failed.",
			approve: "Retry",
			detail: askText,
		},
		mistake_limit_reached: {
			kind: "Needs guidance",
			prompt: "The model keeps failing. Proceed, or write it guidance below.",
			approve: "Proceed Anyways",
			detail: askText,
		},
		auto_approval_max_req_reached: {
			kind: "Limit reached",
			prompt: "The auto-approved request limit was reached.",
			approve: "Reset and Continue",
		},
	}

	function valueOf(field, ask, obj) {
		return typeof field === "function" ? field(ask, obj) : field
	}

	function parseText(text) {
		try {
			var obj = JSON.parse(text || "")
			return obj && typeof obj === "object" ? obj : {}
		} catch (e) {
			return {}
		}
	}

	// A suggestion is a string or { answer, mode }; one without a usable answer is
	// dropped, as the extension does (packages/types followup.ts).
	function suggestionsOf(obj) {
		var list = obj.suggest || obj.suggestions
		if (!Array.isArray(list)) return []
		return list
			.map(function (s) {
				return typeof s === "string" ? { answer: s } : { answer: s && s.answer, mode: s && s.mode }
			})
			.filter(function (s) {
				return typeof s.answer === "string" && s.answer.trim() !== ""
			})
	}

	var dockAsk = null // the ask the dock shows
	var dockKey = null // what it was drawn from, so a repeated snapshot does not redraw it

	function markdownHelpers() {
		return window.TumbleConversation || null
	}

	function showDock(ask) {
		var spec = ASK_DOCK[ask.ask]
		var key = ask.ts + "|" + (ask.partial ? 1 : 0) + "|" + (ask.text || "")
		dockAsk = ask
		if (key === dockKey) return
		dockKey = key
		var obj = parseText(ask.text)
		var helpers = markdownHelpers()
		els.dockKind.textContent = spec.kind
		els.dockSuggestions.innerHTML = ""
		var offline = !controlsOnline || !!ask.partial

		if (ask.ask === "followup") {
			// While streaming the text is the bare question, not yet JSON.
			var question = obj.question || (obj.suggest ? "" : ask.text || "")
			els.dockQuestion.innerHTML = helpers ? helpers.markdown(question) : ""
			suggestionsOf(obj).forEach(function (s) {
				var b = document.createElement("button")
				b.type = "button"
				b.className = "btn suggestion"
				b.disabled = offline
				var label = document.createElement("span")
				label.className = "suggestion-answer"
				label.innerHTML = helpers ? helpers.inlineMarkdown(s.answer) : ""
				b.appendChild(label)
				if (s.mode) {
					var mode = document.createElement("span")
					mode.className = "suggestion-mode"
					mode.textContent = "→ " + s.mode + " mode"
					b.appendChild(mode)
				}
				b.addEventListener("click", function () {
					answerFollowup(s.answer, s.mode)
				})
				els.dockSuggestions.appendChild(b)
			})
			els.dockSuggestions.hidden = !els.dockSuggestions.childNodes.length
			els.dockDetail.hidden = true
			els.dockDecide.hidden = true
			els.dockOwn.hidden = false
			setPlaceholder("Your answer… (or pick one above)")
		} else {
			var approve = valueOf(spec.approve, ask, obj)
			var deny = valueOf(spec.deny, ask, obj)
			var detail = valueOf(spec.detail, ask, obj)
			els.dockQuestion.textContent = spec.prompt
			els.dockDetail.textContent = detail || ""
			els.dockDetail.hidden = !detail
			els.dockSuggestions.hidden = true
			els.dockOwn.hidden = true
			els.dockApprove.textContent = approve
			els.dockApprove.disabled = offline
			els.dockDeny.textContent = deny || ""
			els.dockDeny.hidden = !deny
			els.dockDeny.disabled = offline
			els.dockComment.hidden = !deny
			els.dockDecide.hidden = false
			setPlaceholder(deny ? "Optional comment for " + approve + " / " + deny + "…" : composerPlaceholder)
		}
		els.dock.hidden = false
		refreshState()
	}

	function hideDock() {
		dockAsk = null
		dockKey = null
		if (!els.dock) return
		els.dock.hidden = true
		setPlaceholder(composerPlaceholder)
		refreshState()
	}

	function setPlaceholder(text) {
		if (els.input) els.input.placeholder = text
	}

	// Mark the pending ask's row and dock its actions above the composer.
	function updateAskFromState(ask) {
		var c = getConvo()
		var docked = ask && ask.ts != null && !answered[ask.ts] && ASK_DOCK[ask.ask] && els.dock
		if (docked) {
			if (c && c.setActiveAsk) c.setActiveAsk(ask.ts)
			showDock(ask)
		} else {
			if (c && c.clearActiveAsk) c.clearActiveAsk()
			hideDock()
		}
	}

	function resolveAsk(decision, answer) {
		var ask = dockAsk
		if (!ask) return
		answered[ask.ts] = true
		var c = getConvo()
		if (c) c.markResolved(ask.ts, decision, answer)
		lastAsk = null
		hideDock()
	}

	// The extension answers a pending followup with a plain message (Task
	// submitUserMessage), exactly as the panel's suggestion buttons do.
	function answerFollowup(text, mode) {
		var payload = { text: text }
		if (mode) payload.mode = mode
		sendCommand("message", { payload: payload })
		resolveAsk("answered", text)
	}

	function decide(type, decision) {
		var payload = {}
		var text = ((els.input && els.input.value) || "").trim()
		if (text) {
			payload.text = text
			els.input.value = ""
		}
		sendCommand(type, { payload: payload })
		resolveAsk(decision)
	}

	if (els.dockApprove)
		els.dockApprove.addEventListener("click", function () {
			decide("approve_ask", "approved")
		})
	if (els.dockDeny)
		els.dockDeny.addEventListener("click", function () {
			decide("deny_ask", "denied")
		})
	if (els.dockJump)
		els.dockJump.addEventListener("click", function (e) {
			e.preventDefault()
			var c = getConvo()
			if (dockAsk && c && c.revealRow) c.revealRow(dockAsk.ts)
		})

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
			if (els.input) els.input.value = ""
			if (dockAsk && dockAsk.ask === "followup" && !dockAsk.partial) {
				answerFollowup(text)
				return
			}
			sendCommand("message", { payload: { text: text } })
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
	;[els.stop, els.headStop].forEach(function (el) {
		if (el)
			el.addEventListener("click", function () {
				sendCommand("stop_task", {})
			})
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

	// Phone folds (app.css): a button opens its part by a class on `host`.
	function fold(button, host, cls) {
		if (!button || !host) return
		button.addEventListener("click", function () {
			var open = host.classList.toggle(cls)
			button.setAttribute("aria-expanded", open ? "true" : "false")
		})
	}
	fold(document.getElementById("auto-more"), els.controls, "show-auto")
	fold(document.getElementById("details-toggle"), els.header, "show-details")
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
