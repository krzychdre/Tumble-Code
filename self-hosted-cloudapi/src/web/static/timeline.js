/*
 * The task page's timeline: a slim strip of ticks, one per API request (its
 * size is the request's cost against the dearest one), per error, retry or
 * failed request, and per message of yours. A tick scrolls to its row. "Next
 * error" and "Next message of yours" walk those rows from where the reader is
 * and wrap round.
 *
 * Everything is read off the rendered conversation (render.js puts data-ts,
 * data-kind, data-cost and data-failed on the rows), so there is no new
 * endpoint; a MutationObserver redraws it when the live bridge adds or
 * replaces a row.
 */
;(function () {
	"use strict"

	// A request that cost nothing, or next to nothing, still gets a visible tick.
	var MIN_SIZE = 0.15

	function init() {
		var nav = document.getElementById("timeline")
		var track = document.getElementById("tl-track")
		var container = document.getElementById("conversation")
		if (!nav || !track || !container) return

		var current = null

		function rows() {
			return Array.prototype.slice.call(container.querySelectorAll(":scope > .msg[data-ts]"))
		}

		function kindOf(row, index) {
			if (row.classList.contains("role-user")) return "user"
			// The task itself: the first message is a plain "text" say, which the
			// renderer sets like any other text, but it is what you asked.
			if (index === 0 && row.getAttribute("data-kind") === "text") return "user"
			if (
				row.classList.contains("role-error") ||
				row.getAttribute("data-kind") === "api_req_retry_delayed" ||
				row.hasAttribute("data-failed")
			)
				return "error"
			if (row.classList.contains("role-api")) return "request"
			return null
		}

		function describe(row, kind) {
			var time = new Date(Number(row.getAttribute("data-ts")))
			var when = isNaN(time) ? "" : ", " + time.toLocaleTimeString()
			if (kind === "user") return "Your message" + when
			if (kind === "request") {
				var cost = parseFloat(row.getAttribute("data-cost"))
				var money = isNaN(cost) ? "" : ", " + window.TumbleFormat.cost(cost)
				return "API request" + money + when
			}
			if (row.hasAttribute("data-failed")) return "Failed API request" + when
			if (row.getAttribute("data-kind") === "api_req_retry_delayed") return "Provider retry" + when
			return "Error" + when
		}

		function build() {
			var entries = rows()
				.map(function (row, index) {
					return { row: row, kind: kindOf(row, index), cost: parseFloat(row.getAttribute("data-cost")) }
				})
				.filter(function (e) {
					return e.kind
				})
			var dearest = entries.reduce(function (max, e) {
				return e.kind === "request" && e.cost > max ? e.cost : max
			}, 0)
			var fragment = document.createDocumentFragment()
			entries.forEach(function (e) {
				var tick = document.createElement("button")
				tick.type = "button"
				tick.className = "tl-tick tl-" + e.kind
				// One stop in the tab order is the two jump buttons, not hundreds
				// of ticks; the ticks are for the pointer.
				tick.tabIndex = -1
				tick.setAttribute("data-ts", e.row.getAttribute("data-ts"))
				var size = 1
				if (e.kind === "request")
					size = dearest > 0 && e.cost > 0 ? Math.max(MIN_SIZE, e.cost / dearest) : MIN_SIZE
				tick.style.setProperty("--v", String(size))
				var label = describe(e.row, e.kind)
				tick.setAttribute("aria-label", label)
				tick.title = label
				fragment.appendChild(tick)
			})
			track.textContent = ""
			track.appendChild(fragment)
			nav.hidden = entries.length === 0
		}

		function reducedMotion() {
			return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
		}

		function goTo(row) {
			if (!row) return
			if (current && current !== row) current.classList.remove("tl-target")
			current = row
			row.classList.add("tl-target")
			row.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" })
			// Keyboard focus follows: the row's own summary when it folds, the row
			// itself otherwise.
			var focusable = row.querySelector(":scope > details > summary")
			if (!focusable) {
				row.tabIndex = -1
				focusable = row
			}
			focusable.focus({ preventScroll: true })
		}

		// Reading on by hand (wheel, touch, keys) means the next jump starts from
		// the viewport again, not from the row the last jump landed on. A scroll
		// event alone cannot tell, because the jump's own smooth scroll fires it.
		function forget() {
			current = null
		}
		window.addEventListener("wheel", forget, { passive: true })
		window.addEventListener("touchmove", forget, { passive: true })
		window.addEventListener("keydown", function (e) {
			if (/^(PageUp|PageDown|Home|End|ArrowUp|ArrowDown| )$/.test(e.key)) forget()
		})

		// The row after where the reader is: after the last jump's row, or after
		// the top of the viewport once the reader has scrolled by hand.
		function next(kind) {
			var all = rows()
			var matching = all.filter(function (row, index) {
				return kindOf(row, index) === kind
			})
			if (!matching.length) return
			var from = current && current.isConnected ? all.indexOf(current) : -1
			var pick = null
			if (from !== -1) {
				pick = matching.filter(function (row) {
					return all.indexOf(row) > from
				})[0]
			} else {
				pick = matching.filter(function (row) {
					return row.getBoundingClientRect().top > 1
				})[0]
			}
			goTo(pick || matching[0])
		}

		track.addEventListener("click", function (e) {
			var tick = e.target.closest(".tl-tick")
			if (!tick) return
			var ts = tick.getAttribute("data-ts")
			goTo(
				rows().filter(function (row) {
					return row.getAttribute("data-ts") === ts
				})[0],
			)
		})

		var nextError = document.getElementById("tl-next-error")
		var nextUser = document.getElementById("tl-next-user")
		if (nextError)
			nextError.addEventListener("click", function () {
				next("error")
			})
		if (nextUser)
			nextUser.addEventListener("click", function () {
				next("user")
			})

		var pending = null
		function schedule() {
			if (pending) return
			pending = setTimeout(function () {
				pending = null
				build()
			}, 60)
		}
		if (typeof MutationObserver === "function") {
			new MutationObserver(schedule).observe(container, { childList: true })
		}
		build()
	}

	// render.js builds the conversation on DOMContentLoaded when the page is
	// still loading; registered after it, this runs after it.
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init)
	else init()
})()
