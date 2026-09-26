/*
 * Number formatting for the web panel's scripts, shared as window.TumbleFormat.
 *
 * The server renders the same figures first (src/utils/format.py) and the
 * scripts rewrite some of them live, so the two must agree to the character:
 * tests/test_format_golden.py checks one table of inputs and expected strings
 * against both. Load this before render.js, live.js and metrics.js.
 */
;(function () {
	"use strict"

	// Compact token count: 1 000 000 -> "1M", 96 941 -> "96.9k", 512 -> "512".
	// Below a thousand the count is rounded to the nearest integer. A figure
	// that is not known yet reads as an em dash (U+2014).
	function tokens(n) {
		if (n == null) return "\u2014"
		var num = Number(n)
		if (!isFinite(num)) return "\u2014"
		var units = [
			[1e9, "B"],
			[1e6, "M"],
			[1e3, "k"],
		]
		for (var i = 0; i < units.length; i++) {
			if (Math.abs(num) >= units[i][0]) {
				// One decimal, but drop a trailing ".0" so 1 000 000 -> "1M".
				return (num / units[i][0]).toFixed(1).replace(/\.0$/, "") + units[i][1]
			}
		}
		return String(Math.round(num))
	}

	// A cost to four places: 0.1656 -> "$0.1656".
	function cost(dollars) {
		return "$" + Number(dollars).toFixed(4)
	}

	window.TumbleFormat = { tokens: tokens, cost: cost }
})()
