/*
 * Keeps the owner's task page at its newest message while the reader is at the
 * bottom. Scrolling up stops that and offers a "Latest" pill; reaching the
 * bottom again, by hand or with the pill, resumes it.
 *
 * Knows nothing of render.js: it watches #conversation change (MutationObserver)
 * and grow without a change, as images and diagrams load (ResizeObserver).
 * live.js calls TumbleFollow.toTail() the first time it learns the task is
 * live, so a live task opens at its tail and a finished one at the top.
 */
;(function () {
	"use strict"

	var convo = document.getElementById("conversation")
	var controls = document.getElementById("live-controls")
	if (!convo || !controls) return

	var NEAR_BOTTOM_PX = 80
	var scroller = document.scrollingElement || document.documentElement
	var following = false
	var live = false
	var unseen = 0
	var lastTop = scroller.scrollTop

	var pill = document.createElement("button")
	pill.type = "button"
	pill.className = "btn small follow-jump"
	pill.hidden = true
	controls.insertBefore(pill, controls.firstChild)

	function nearBottom() {
		return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= NEAR_BOTTOM_PX
	}

	// Instant, never smooth: the steps of a smooth scroll are scroll events
	// short of the bottom, and would read as the reader scrolling away.
	function toBottom() {
		scroller.scrollTop = scroller.scrollHeight
		lastTop = scroller.scrollTop
	}

	// Offered only where there is something to catch up on.
	function showPill() {
		pill.hidden = following || !(live || unseen)
		pill.textContent = unseen ? "↓ Latest (" + unseen + " new)" : "↓ Latest"
	}

	function follow() {
		following = true
		unseen = 0
		showPill()
	}

	// Content growing below never lowers scrollTop, so only a move up is the
	// reader leaving the tail.
	window.addEventListener(
		"scroll",
		function () {
			var top = scroller.scrollTop
			if (nearBottom()) {
				follow()
			} else if (top < lastTop) {
				following = false
				showPill()
			}
			lastTop = top
		},
		{ passive: true },
	)

	pill.addEventListener("click", function () {
		follow()
		toBottom()
	})

	function isRow(n) {
		return n.nodeType === 1 && n.classList.contains("msg")
	}

	function count(nodes) {
		return Array.prototype.filter.call(nodes, isRow).length
	}

	// Observed after render.js drew the stored history (its DOMContentLoaded
	// listener was added first), so only rows that arrive later count as new.
	function watch() {
		new ResizeObserver(function () {
			if (following) toBottom()
		}).observe(convo)
		new MutationObserver(function (records) {
			if (following) {
				toBottom()
				return
			}
			// Rows are the conversation's children. A streaming row swapped for
			// its next version adds one and removes one: not a new message.
			records.forEach(function (r) {
				if (r.target === convo) unseen += Math.max(0, count(r.addedNodes) - count(r.removedNodes))
			})
			showPill()
		}).observe(convo, { childList: true, subtree: true, characterData: true, attributes: true })
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", watch)
	} else {
		watch()
	}

	window.TumbleFollow = {
		toTail: function () {
			live = true
			follow()
			toBottom()
		},
	}
})()
