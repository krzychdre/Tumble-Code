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
 * auto, dark, light. Every change fires "tumble:theme" on window, so anything
 * drawn with the theme's colours (the metrics charts) can draw again.
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

	function label(theme) {
		return theme.charAt(0).toUpperCase() + theme.slice(1)
	}

	function bind() {
		var toggle = document.getElementById("theme-toggle")
		if (!toggle) return
		function show(theme) {
			var next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
			toggle.textContent = label(theme)
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
			window.dispatchEvent(new Event("tumble:theme"))
		})
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind)
	else bind()
})()
