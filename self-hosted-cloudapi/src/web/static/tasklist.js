/*
 * Task-list selection: checkboxes, shift-click ranges, and the bulk action bar;
 * and folding the run tree open and shut.
 *
 * Progressive enhancement. The form and every button work without this file —
 * the bar starts hidden and is only revealed here, so with scripting off the
 * per-row Delete still posts and nothing on the page is a dead control. The
 * tree toggles are hidden by a <noscript> style instead, which also unfolds
 * every subtree, so without scripting the whole tree is simply shown.
 *
 * Confirmations are attached here rather than as inline `onsubmit` handlers so
 * the page needs no inline script, and so the bulk confirmation can state the
 * real count instead of a fixed sentence.
 */
;(function () {
	"use strict"

	var form = document.getElementById("bulk-form")
	if (!form) return

	var bar = document.getElementById("bulk-bar")
	var countEl = document.getElementById("bulk-n")
	var childrenEl = document.getElementById("bulk-children")
	var subtasksWrap = document.getElementById("bulk-subtasks-wrap")
	var includeSubtasks = document.getElementById("include-subtasks")
	var selectAll = document.getElementById("select-all")
	var clearBtn = document.getElementById("bulk-clear")
	var deleteBtn = document.getElementById("bulk-delete")

	function toArray(list) {
		return Array.prototype.slice.call(list)
	}

	function boxes() {
		return toArray(form.querySelectorAll('input[name="task_ids"]'))
	}

	// The rows a reader can see: not inside a folded subtree. "Select page" and
	// shift-click ranges act on these only: a range dragged across a folded run
	// must not quietly pick up subtasks nobody looked at.
	function visibleBoxes() {
		return boxes().filter(function (b) {
			return !b.closest(".task-children[hidden]")
		})
	}

	function selected() {
		return boxes().filter(function (b) {
			return b.checked
		})
	}

	// How many subtasks the current selection would drag along, so the offer is
	// only made when it would actually do something. In the run tree the
	// subtasks are on the page, nested under their run, so they are counted
	// there: once each, and not at all when they are already selected
	// themselves. A row with nothing nested under it (the flat view) carries the
	// size of its subtree instead.
	function childCount(list) {
		var nested = {}
		var elsewhere = 0
		list.forEach(function (b) {
			var node = b.closest(".task-node")
			var below = node ? toArray(node.querySelectorAll('.task-children input[name="task_ids"]')) : []
			if (!below.length) {
				elsewhere += Number(b.getAttribute("data-child-count")) || 0
				return
			}
			below.forEach(function (sub) {
				if (!sub.checked) nested[sub.value] = true
			})
		})
		return Object.keys(nested).length + elsewhere
	}

	function refresh() {
		var chosen = selected()
		var n = chosen.length
		if (countEl) countEl.textContent = String(n)
		if (bar) bar.hidden = n === 0

		var children = childCount(chosen)
		if (subtasksWrap) subtasksWrap.hidden = children === 0
		if (childrenEl) childrenEl.textContent = String(children)
		// A hidden checkbox must not keep a stale tick that would silently widen
		// the delete on the next submission.
		if (children === 0 && includeSubtasks) includeSubtasks.checked = false

		if (selectAll) {
			var visible = visibleBoxes()
			var ticked = visible.filter(function (b) {
				return b.checked
			}).length
			selectAll.checked = ticked > 0 && ticked === visible.length
			selectAll.indeterminate = ticked > 0 && ticked < visible.length
		}

		boxes().forEach(function (b) {
			var row = b.closest(".task-item")
			if (row) row.classList.toggle("selected", b.checked)
		})
	}

	// Shift-click selects the range from the last box clicked, the way a file
	// manager does — the alternative for "delete these forty" is forty clicks.
	// The anchor is the box itself rather than its position: folding or
	// unfolding a run between the two clicks moves every position after it.
	var lastBox = null
	form.addEventListener("click", function (e) {
		var box = e.target
		if (!box || box.name !== "task_ids") return
		var visible = visibleBoxes()
		var index = visible.indexOf(box)
		var anchor = lastBox ? visible.indexOf(lastBox) : -1
		if (e.shiftKey && anchor !== -1 && index !== -1) {
			var from = Math.min(anchor, index)
			var to = Math.max(anchor, index)
			for (var i = from; i <= to; i++) visible[i].checked = box.checked
		}
		lastBox = box
		refresh()
	})

	if (selectAll) {
		selectAll.addEventListener("change", function () {
			visibleBoxes().forEach(function (b) {
				b.checked = selectAll.checked
			})
			lastBox = null
			refresh()
		})
	}

	if (clearBtn) {
		clearBtn.addEventListener("click", function () {
			boxes().forEach(function (b) {
				b.checked = false
			})
			lastBox = null
			refresh()
		})
	}

	if (includeSubtasks) includeSubtasks.addEventListener("change", refresh)

	// --- the run tree ---------------------------------------------------------

	var expandAll = document.getElementById("tree-expand-all")

	function toggles() {
		return toArray(form.querySelectorAll(".tree-toggle"))
	}

	function isOpen(toggle) {
		return toggle.getAttribute("aria-expanded") === "true"
	}

	function setOpen(toggle, open) {
		var subtree = document.getElementById(toggle.getAttribute("aria-controls"))
		if (!subtree) return
		subtree.hidden = !open
		toggle.setAttribute("aria-expanded", open ? "true" : "false")
	}

	function allOpen() {
		var all = toggles()
		return all.length > 0 && all.every(isOpen)
	}

	function refreshExpandAll() {
		if (!expandAll) return
		expandAll.hidden = toggles().length === 0
		expandAll.textContent = allOpen() ? "Collapse all" : "Expand all"
	}

	form.addEventListener("click", function (e) {
		var toggle = e.target.closest(".tree-toggle")
		if (!toggle) return
		setOpen(toggle, !isOpen(toggle))
		refreshExpandAll()
		// What "Select page" reflects is what is visible, and that just changed.
		refresh()
	})

	if (expandAll) {
		expandAll.addEventListener("click", function () {
			var open = !allOpen()
			toggles().forEach(function (t) {
				setOpen(t, open)
			})
			refreshExpandAll()
			refresh()
		})
	}

	refreshExpandAll()

	// --- confirmations -------------------------------------------------------

	// The per-row button posts to its own endpoint via formaction, so it must
	// confirm for itself; the submit listener below would otherwise ask the bulk
	// question for a single-row delete.
	form.addEventListener("click", function (e) {
		var btn = e.target.closest("[data-confirm]")
		if (!btn) return
		if (!window.confirm(btn.getAttribute("data-confirm"))) {
			e.preventDefault()
		} else {
			btn.setAttribute("data-confirmed", "1")
		}
	})

	form.addEventListener("submit", function (e) {
		var submitter = e.submitter
		if (submitter && submitter.hasAttribute("data-confirm")) {
			// Already answered in the click handler above.
			submitter.removeAttribute("data-confirmed")
			return
		}

		var n = selected().length
		if (n === 0) {
			e.preventDefault()
			return
		}
		var extra = includeSubtasks && includeSubtasks.checked ? childCount(selected()) : 0
		var what = n + " task" + (n === 1 ? "" : "s")
		if (extra) what += " and " + extra + " subtask" + (extra === 1 ? "" : "s")
		if (!window.confirm("Delete " + what + " permanently, with every conversation? This cannot be undone.")) {
			e.preventDefault()
			return
		}
		if (deleteBtn) deleteBtn.disabled = true
	})

	refresh()
})()
