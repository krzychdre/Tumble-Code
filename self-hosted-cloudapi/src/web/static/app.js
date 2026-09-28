/*
 * Behaviour every page of the panel shares. Loaded with `defer` from
 * base.html, so it runs once the document is parsed.
 *
 * - A form with data-confirm asks that question before it submits. These were
 *   inline onsubmit handlers; as attributes they let the pages run under a
 *   Content Security Policy whose script-src is only 'self'.
 * - A button with data-copy="<selector>" copies that element's text. It
 *   starts hidden (it does nothing without scripting) and is revealed here.
 */
;(function () {
	"use strict"

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
