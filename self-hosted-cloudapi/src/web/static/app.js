/*
 * Behaviour every page of the panel shares. Loaded with `defer` from
 * base.html, so it runs once the document is parsed.
 *
 * - A form with data-confirm asks that question before it submits. These were
 *   inline onsubmit handlers; as attributes they let the pages run under a
 *   Content Security Policy whose script-src is only 'self'.
 * - A button with data-copy="<selector>" copies that element's text. It
 *   starts hidden (it does nothing without scripting) and is revealed here.
 * - A button with data-copy-url="<url>" fetches that URL (same origin, with
 *   the session cookie) and copies the response text: the problem report's
 *   "Copy for agent". Hidden until revealed here, like data-copy.
 * - A form with data-autosubmit submits itself when one of its lists
 *   changes, so a filter applies on its own; its Apply button still works
 *   without scripting.
 * - The browser's time zone goes to the server in the tumble_tz cookie
 *   (utils/clientzone.py): "today", the daily buckets and every printed time
 *   are the reader's. A page computed in another zone (body data-tz, e.g. UTC
 *   on the first visit) reloads once, only if the cookie stuck, and never
 *   twice for the same zone, so blocked cookies cannot loop.
 */
;(function () {
	"use strict"
	;(function syncTimeZone() {
		var zone
		try {
			zone = Intl.DateTimeFormat().resolvedOptions().timeZone
		} catch (err) {
			return
		}
		if (!zone || !/^[A-Za-z0-9_+\-\/]{1,64}$/.test(zone)) return
		var current = (document.cookie.match(/(?:^|;\s*)tumble_tz=([^;]*)/) || [])[1]
		if (current !== zone) {
			document.cookie =
				"tumble_tz=" +
				zone +
				"; path=/; max-age=31536000; samesite=lax" +
				(location.protocol === "https:" ? "; secure" : "")
		}
		var rendered = document.body && document.body.getAttribute("data-tz")
		if (!rendered || rendered === zone) return
		var stuck = (document.cookie.match(/(?:^|;\s*)tumble_tz=([^;]*)/) || [])[1] === zone
		var key = "tumble_tz_reloaded"
		var done
		try {
			done = sessionStorage.getItem(key)
		} catch (err) {
			done = zone
		}
		if (!stuck || done === zone) return
		try {
			sessionStorage.setItem(key, zone)
		} catch (err) {
			return
		}
		location.reload()
	})()

	document.addEventListener("submit", function (e) {
		var form = e.target
		if (!form || typeof form.getAttribute !== "function") return
		var question = form.getAttribute("data-confirm")
		if (question && !window.confirm(question)) e.preventDefault()
	})

	function copyText(text) {
		if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text)
		// Older browsers and plain-http pages without the async clipboard.
		return new Promise(function (resolve, reject) {
			var area = document.createElement("textarea")
			area.value = text
			area.setAttribute("readonly", "")
			area.className = "sr-only"
			document.body.appendChild(area)
			area.select()
			var ok = false
			try {
				ok = document.execCommand("copy")
			} catch (err) {
				ok = false
			}
			document.body.removeChild(area)
			if (ok) resolve()
			else reject(new Error("copy failed"))
		})
	}

	document.addEventListener("change", function (e) {
		var field = e.target
		if (!field || field.tagName !== "SELECT" || !field.form) return
		if (!field.form.hasAttribute("data-autosubmit")) return
		if (typeof field.form.requestSubmit === "function") field.form.requestSubmit()
		else field.form.submit()
	})

	// Said once to a screen reader, when the page has a live region for it.
	function announce(text) {
		var status = document.getElementById("copy-status")
		if (status) status.textContent = text
	}

	function fetchText(url) {
		return fetch(url, { credentials: "same-origin" }).then(function (resp) {
			if (!resp.ok) throw new Error("HTTP " + resp.status)
			return resp.text()
		})
	}

	// Copies what ``url`` answers. Where ClipboardItem takes a promise, the
	// clipboard write starts inside the click (Safari refuses a write that
	// starts after an await); elsewhere the text is fetched first.
	function copyFromUrl(url) {
		if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
			try {
				var blob = fetchText(url).then(function (text) {
					return new Blob([text], { type: "text/plain" })
				})
				return navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]).catch(function () {
					return fetchText(url).then(copyText)
				})
			} catch (err) {
				// A ClipboardItem that does not take a promise: the plain way.
			}
		}
		return fetchText(url).then(copyText)
	}

	Array.prototype.slice.call(document.querySelectorAll("[data-copy-url]")).forEach(function (btn) {
		var label = btn.textContent
		btn.hidden = false
		btn.addEventListener("click", function () {
			btn.disabled = true
			copyFromUrl(btn.getAttribute("data-copy-url"))
				.then(
					function () {
						btn.textContent = "Copied"
						announce("Brief copied to the clipboard")
					},
					function () {
						// No clipboard here (plain http, a denied permission): the
						// download link beside the button still works.
						btn.textContent = "Copy failed, use Download"
						announce("Copying failed; use Download brief instead")
					},
				)
				.then(function () {
					setTimeout(function () {
						btn.textContent = label
						btn.disabled = false
					}, 2500)
				})
		})
	})

	Array.prototype.slice.call(document.querySelectorAll("[data-copy]")).forEach(function (btn) {
		var source = document.querySelector(btn.getAttribute("data-copy"))
		if (!source) return
		var label = btn.textContent
		btn.hidden = false
		btn.addEventListener("click", function () {
			copyText(source.textContent.trim()).then(
				function () {
					btn.textContent = "Copied"
					setTimeout(function () {
						btn.textContent = label
					}, 1500)
				},
				function () {
					// Leave the text selectable instead.
					var range = document.createRange()
					range.selectNodeContents(source)
					var sel = window.getSelection()
					sel.removeAllRanges()
					sel.addRange(range)
				},
			)
		})
	})
})()
