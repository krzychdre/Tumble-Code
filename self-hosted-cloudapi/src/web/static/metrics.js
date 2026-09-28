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

	// Every colour is a CSS variable of app.css, read when the charts are
	// drawn, so they follow the theme (and draw again when it changes). Tokens
	// are "in" (cold cyan) and cost is the signal amber, so the daily chart uses
	// the same encoding as the stat cards above it: a reader learns the colour
	// once. The doughnuts take the categorical --cat-N hues.
	var CATEGORIES = 10

	function cssVar(name) {
		return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
	}

	function colours() {
		var palette = []
		for (var i = 1; i <= CATEGORIES; i++) palette.push(cssVar("--cat-" + i))
		return {
			tokens: cssVar("--d-in"),
			cost: cssVar("--d-cost"),
			grid: cssVar("--line"),
			text: cssVar("--text-faint"),
			panel: cssVar("--surface-1"),
			palette: palette,
		}
	}

	Chart.defaults.font.family =
		'ui-monospace, "JetBrains Mono", "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace'
	Chart.defaults.font.size = 11

	// The same compact counts and costs the server renders (static/format.js).
	var fmtTokens = window.TumbleFormat.tokens
	var fmtCost = window.TumbleFormat.cost

	function get(id) {
		return document.getElementById(id)
	}

	var charts = []
	var c = colours()

	// Per-day tokens (bars) + cost (line on a second axis).
	function drawDaily() {
		var dailyEl = get("chart-daily")
		if (dailyEl && data.days && data.days.length) {
			charts.push(
				new Chart(dailyEl, {
					data: {
						labels: data.days,
						datasets: [
							{
								type: "bar",
								label: "Tokens",
								data: data.day_tokens,
								backgroundColor: c.tokens,
								borderRadius: 3,
								yAxisID: "y",
								order: 2,
							},
							{
								type: "line",
								label: "Cost ($)",
								data: data.day_cost,
								borderColor: c.cost,
								backgroundColor: c.cost,
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
											return "Cost: " + fmtCost(ctx.parsed.y)
										}
										return "Tokens: " + Number(ctx.parsed.y).toLocaleString()
									},
								},
							},
						},
						scales: {
							x: { grid: { color: c.grid } },
							y: {
								position: "left",
								grid: { color: c.grid },
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
				}),
			)
		}
	}

	function doughnut(elId, labels, values) {
		var el = get(elId)
		if (!el || !labels || !labels.length) return
		charts.push(
			new Chart(el, {
				type: "doughnut",
				data: {
					labels: labels,
					datasets: [
						{
							data: values,
							backgroundColor: labels.map(function (_, i) {
								return c.palette[i % c.palette.length]
							}),
							borderColor: c.panel,
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
			}),
		)
	}

	function draw() {
		charts.forEach(function (chart) {
			chart.destroy()
		})
		charts = []
		c = colours()
		Chart.defaults.color = c.text
		drawDaily()
		doughnut("chart-models", data.model_labels, data.model_tokens)
		doughnut("chart-modes", data.mode_labels, data.mode_tokens)
	}

	draw()

	// The OS switching between light and dark, and the reader's own toggle
	// (static/theme.js), both change the variables the charts were drawn with.
	var scheme = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null
	if (scheme && scheme.addEventListener) scheme.addEventListener("change", draw)
	window.addEventListener("tumble:theme", draw)
})()
