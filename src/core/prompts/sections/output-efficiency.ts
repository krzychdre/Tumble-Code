// Conciseness steering for the agent loop. Decode time dominates per-turn
// latency on slow endpoints (see ai_plans/2026-07-12_glm-agent-loop-efficiency.md),
// so every generated character costs wall-clock. Rules are short imperatives so
// weak models follow them reliably.
export function getOutputEfficiencySection(): string {
	return `# Output Efficiency

- Go straight to the point. Lead with the action or the answer, not the reasoning behind it.
- Write at most one short sentence before or between tool calls. Never narrate a plan and then execute it — just execute.
- Never restate the user's request, quote a file's content back, or summarize what a tool returned. Use results silently.
- Do not announce what you are about to do ("Now I will read the file") or confirm what you did ("I have successfully edited"). The tool calls and results are already visible.
- Keep the final result under 100 words unless the task genuinely requires more detail. One sentence is better than three.`
}
