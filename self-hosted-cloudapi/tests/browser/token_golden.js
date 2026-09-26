// Checks render.js getMetrics against the shared token/cost fixture
// (tests/fixtures/token_usage_golden.json, CAPI-M8). The page that loads this
// script is written by tests/test_token_golden_fixtures.py: it inlines the
// fixture as a JSON island (a file:// page cannot fetch a sibling file) and
// loads the real render.js before this file.
//
// getMetrics computes totalTokensIn/Out, totalCost and contextTokens; it has no
// cache totals. A case listed under knownDivergences.js must still disagree
// (a strict expected failure), so a fix shows up as a failure to clean up.
window.addEventListener("load", function () {
	var out = [],
		fail = 0
	function report(ok, line) {
		out.push((ok ? "PASS " : "FAIL ") + line)
		if (!ok) fail++
	}

	var cases = []
	try {
		cases = JSON.parse(document.getElementById("golden").textContent).cases
	} catch (e) {
		report(false, "could not read the fixture: " + e)
	}

	var FIELDS = ["totalTokensIn", "totalTokensOut", "totalCost", "contextTokens"]

	function same(field, actual, expected) {
		if (field === "totalCost") return typeof actual === "number" && Math.abs(actual - expected) < 1e-9
		return actual === expected
	}

	cases.forEach(function (c) {
		var host = document.createElement("div")
		document.body.appendChild(host)
		var metrics
		try {
			var convo = window.TumbleConversation.mount(host)
			convo.renderAll(c.messages)
			metrics = convo.getMetrics()
		} catch (e) {
			report(false, c.name + ": threw " + e)
			return
		}
		var mismatches = FIELDS.filter(function (f) {
			return !same(f, metrics[f], c.expected[f])
		}).map(function (f) {
			return f + " got " + metrics[f] + " expected " + c.expected[f]
		})
		var divergence = c.knownDivergences && c.knownDivergences.js
		if (divergence) {
			report(
				mismatches.length > 0,
				c.name +
					(mismatches.length
						? " (known divergence: " + mismatches.join(", ") + ")"
						: ": the known JS divergence is gone, remove knownDivergences.js from the fixture"),
			)
		} else {
			report(mismatches.length === 0, c.name + (mismatches.length ? ": " + mismatches.join(", ") : ""))
		}
	})

	out.push("CASES=" + cases.length)
	out.push("TOTAL_FAILURES=" + fail)
	var pre = document.createElement("pre")
	pre.id = "results"
	pre.textContent = out.join("\n")
	document.body.appendChild(pre)
})
