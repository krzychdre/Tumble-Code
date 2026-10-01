/*
 * The reader's theme: auto (follow the OS), dark or light.
 *
 * Loaded from <head> without defer, before the stylesheet, so the stored
 * choice is on <html> (data-theme) before anything is painted: a reader who
 * chose light never sees a dark flash. "auto" is the absence of the attribute;
 * app.css then follows prefers-color-scheme.
 *
 * Once the document is parsed, the toggle in the top bar is revealed (it
 * starts hidden: without scripting the OS preference still applies) and cycles
 * auto, dark, light. It shows an icon for the current choice; the word is
 * kept for a screen reader, and aria-label also says what a click does.
 */
;(function () {
	"use strict"

	var KEY = "tumble.theme"
	var ORDER = ["auto", "dark", "light"]
	var root = document.documentElement

	function read() {
		try {
			var value = window.localStorage.getItem(KEY)
			return value === "dark" || value === "light" ? value : "auto"
		} catch (e) {
			return "auto"
		}
	}

	function apply(theme) {
		if (theme === "auto") root.removeAttribute("data-theme")
		else root.setAttribute("data-theme", theme)
	}

	var current = read()
	apply(current)

	// 16px line icons: half a disc (follows the system), a moon, a sun.
	var ICONS = {
		auto: '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor"/>',
		dark: '<path d="M13 9.6A5.5 5.5 0 1 1 6.4 3a4.4 4.4 0 0 0 6.6 6.6z"/>',
		light:
			'<circle cx="8" cy="8" r="2.75"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/>',
	}

	function label(theme) {
		return theme.charAt(0).toUpperCase() + theme.slice(1)
	}

	function bind() {
		var toggle = document.getElementById("theme-toggle")
		if (!toggle) return
		function show(theme) {
			var next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
			// Constant markup, no reader data: safe to set as HTML.
			toggle.innerHTML =
				'<svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
				ICONS[theme] +
				'</svg><span class="sr-only">' +
				label(theme) +
				"</span>"
			toggle.setAttribute("data-choice", theme)
			toggle.setAttribute("aria-label", "Theme: " + theme + ". Switch to " + next)
			toggle.title = "Theme: " + theme + " (click for " + next + ")"
		}
		show(current)
		toggle.hidden = false
		toggle.addEventListener("click", function () {
			var theme = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]
			current = theme
			try {
				if (theme === "auto") window.localStorage.removeItem(KEY)
				else window.localStorage.setItem(KEY, theme)
			} catch (e) {
				// Private mode: the choice lasts for this page only.
			}
			apply(theme)
			show(theme)
		})
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind)
	else bind()
})()
