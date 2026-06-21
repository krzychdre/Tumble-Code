/*
 * Renders the usage-metrics charts with Chart.js (vendored, no CDN).
 *
 * Input: a JSON island #metrics-data produced by metrics_service.compute_user_metrics
 *   { days, day_tokens, day_cost, model_labels, model_tokens, mode_labels, mode_tokens }
 *
 * Best-effort, like live.js: if Chart didn't load we leave the (already
 * server-rendered) tables and summary cards untouched.
 */
;(function () {
	"use strict"

	if (typeof window.Chart === "undefined") return

	var dataEl = document.getElementById("metrics-data")
	if (!dataEl) return
	var data
	try {
		data = JSON.parse(dataEl.textContent || "{}")
	} catch (e) {
		return
	}

	// VS Code dark palette (mirrors app.css custom properties).
	var ACCENT = "#4ec9b0"
	var BLUE = "#0078d4"
	var GRID = "rgba(255,255,255,0.06)"
	var TEXT = "#9a9a9a"
	// Distinct hues for categorical doughnuts (model / mode share).
	var PALETTE = [
		"#4ec9b0",
		"#0078d4",
		"#c586c0",
		"#dcdcaa",
		"#ce9178",
		"#569cd6",
		"#d16969",
		"#b5cea8",
		"#9cdcfe",
		"#d7ba7d",
	]

	Chart.defaults.color = TEXT
	Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

	function fmtTokens(n) {
		var num = Number(n) || 0
		var units = [
			[1e9, "B"],
			[1e6, "M"],
			[1e3, "k"],
		]
		for (var i = 0; i < units.length; i++) {
			if (Math.abs(num) >= units[i][0]) {
				return (num / units[i][0]).toFixed(1).replace(/\.0$/, "") + units[i][1]
			}
		}
		return String(Math.round(num))
	}

	function get(id) {
		return document.getElementById(id)
	}

	// Per-day tokens (bars) + cost (line on a second axis).
	var dailyEl = get("chart-daily")
	if (dailyEl && data.days && data.days.length) {
		new Chart(dailyEl, {
			data: {
				labels: data.days,
				datasets: [
					{
						type: "bar",
						label: "Tokens",
						data: data.day_tokens,
						backgroundColor: ACCENT,
						borderRadius: 3,
						yAxisID: "y",
						order: 2,
					},
					{
						type: "line",
						label: "Cost ($)",
						data: data.day_cost,
						borderColor: BLUE,
						backgroundColor: BLUE,
						tension: 0.3,
						pointRadius: 3,
						yAxisID: "yCost",
						order: 1,
					},
				],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: { mode: "index", intersect: false },
				plugins: {
					legend: { labels: { boxWidth: 12 } },
					tooltip: {
						callbacks: {
							label: function (ctx) {
								if (ctx.dataset.yAxisID === "yCost") {
									return "Cost: $" + Number(ctx.parsed.y).toFixed(4)
								}
								return "Tokens: " + Number(ctx.parsed.y).toLocaleString()
							},
						},
					},
				},
				scales: {
					x: { grid: { color: GRID } },
					y: {
						position: "left",
						grid: { color: GRID },
						ticks: { callback: fmtTokens },
					},
					yCost: {
						position: "right",
						grid: { drawOnChartArea: false },
						ticks: {
							callback: function (v) {
								return "$" + v
							},
						},
					},
				},
			},
		})
	}

	function doughnut(elId, labels, values) {
		var el = get(elId)
		if (!el || !labels || !labels.length) return
		new Chart(el, {
			type: "doughnut",
			data: {
				labels: labels,
				datasets: [
					{
						data: values,
						backgroundColor: labels.map(function (_, i) {
							return PALETTE[i % PALETTE.length]
						}),
						borderColor: "#252526",
						borderWidth: 2,
					},
				],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				cutout: "58%",
				plugins: {
					legend: { position: "bottom", labels: { boxWidth: 12 } },
					tooltip: {
						callbacks: {
							label: function (ctx) {
								return ctx.label + ": " + fmtTokens(ctx.parsed) + " tokens"
							},
						},
					},
				},
			},
		})
	}

	doughnut("chart-models", data.model_labels, data.model_tokens)
	doughnut("chart-modes", data.mode_labels, data.mode_tokens)
})()
