import { cn } from "@/lib/utils"
import { ArrowRight, Check, ListChecks, SquareDashed } from "lucide-react"
import { useState, useRef, useMemo, useEffect, useId } from "react"
import { useTranslation } from "react-i18next"

type TodoStatus = "completed" | "in_progress" | "pending"

function getTodoIcon(status: TodoStatus | null) {
	switch (status) {
		case "completed":
			return <Check className={`size-3 mt-1 shrink-0`} />
		case "in_progress":
			return <ArrowRight className="size-3 mt-1 shrink-0" />
		default:
			return <SquareDashed className="size-3 mt-1 shrink-0" />
	}
}

/**
 * The task's todo list under the task header.
 *
 * §2.8 (ai_plans/2026-09-27_ui-modernization.md): the header is a real
 * `<button>` with `aria-expanded` / `aria-controls`, and a thin progress bar
 * (same 3px track as the context bar, §2.4) sits next to the "3/7" count.
 */
export function TodoListDisplay({ todos }: { todos: any[] }) {
	const { t } = useTranslation()
	const listId = useId()
	const [isCollapsed, setIsCollapsed] = useState(true)
	const ulRef = useRef<HTMLUListElement>(null)
	const itemRefs = useRef<(HTMLLIElement | null)[]>([])
	const scrollIndex = useMemo(() => {
		const inProgressIdx = todos.findIndex((todo: any) => todo.status === "in_progress")
		if (inProgressIdx !== -1) return inProgressIdx
		return todos.findIndex((todo: any) => todo.status !== "completed")
	}, [todos])

	// Find the most important todo to display when collapsed
	const mostImportantTodo = useMemo(() => {
		const inProgress = todos.find((todo: any) => todo.status === "in_progress")
		if (inProgress) return inProgress
		return todos.find((todo: any) => todo.status !== "completed")
	}, [todos])
	useEffect(() => {
		if (isCollapsed) return
		if (!ulRef.current) return
		if (scrollIndex === -1) return
		const target = itemRefs.current[scrollIndex]
		if (target && ulRef.current) {
			const ul = ulRef.current
			const targetTop = target.offsetTop - ul.offsetTop
			const targetHeight = target.offsetHeight
			const ulHeight = ul.clientHeight
			const scrollTo = targetTop - (ulHeight / 2 - targetHeight / 2)
			ul.scrollTop = scrollTo
		}
	}, [todos, isCollapsed, scrollIndex])
	if (!Array.isArray(todos) || todos.length === 0) return null

	const totalCount = todos.length
	const completedCount = todos.filter((todo: any) => todo.status === "completed").length

	const allCompleted = completedCount === totalCount && totalCount > 0
	const progressLabel = t("chat:todo.partial", { completed: completedCount, total: totalCount })

	return (
		<div data-todo-list className="mt-1 border border-frame bg-surface rounded-control overflow-hidden">
			<button
				type="button"
				aria-expanded={!isCollapsed}
				aria-controls={listId}
				className={cn(
					"flex w-full min-h-[28px] items-center gap-2 px-2.5 text-left cursor-pointer select-none bg-transparent border-none hover:bg-surface-hover transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-vscode-focusBorder",
					mostImportantTodo?.status === "in_progress" && isCollapsed
						? "text-vscode-charts-yellow"
						: "text-vscode-foreground",
				)}
				onClick={() => setIsCollapsed((v) => !v)}>
				<ListChecks className="size-3 shrink-0" aria-hidden="true" />
				<span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
					{isCollapsed
						? allCompleted
							? t("chat:todo.complete", { total: completedCount })
							: mostImportantTodo?.content // show current todo while not done
						: progressLabel}
				</span>
				<span className="flex shrink-0 items-center gap-1.5 text-vscode-descriptionForeground text-[length:var(--text-meta)] tabular-nums">
					{completedCount}/{totalCount}
					<span
						role="progressbar"
						aria-valuemin={0}
						aria-valuemax={totalCount}
						aria-valuenow={completedCount}
						aria-label={progressLabel}
						className="relative block h-[3px] w-10 overflow-hidden bg-[color-mix(in_srgb,var(--vscode-foreground)_20%,transparent)]">
						<span
							data-todo-progress-fill
							className="absolute inset-y-0 left-0 bg-[var(--status-done)] transition-[width] duration-300 ease-out"
							style={{ width: `${(completedCount / totalCount) * 100}%` }}
						/>
					</span>
				</span>
			</button>
			{/* Inline expanded list */}
			{!isCollapsed && (
				<ul
					id={listId}
					ref={ulRef}
					className="list-none max-h-[300px] overflow-y-auto m-0 pt-2 pb-0 px-2.5 border-t border-frame cursor-default">
					{todos.map((todo: any, idx: number) => {
						const icon = getTodoIcon(todo.status as TodoStatus)
						return (
							<li
								key={todo.id || todo.content}
								ref={(el) => {
									itemRefs.current[idx] = el
								}}
								className={cn(
									"font-light flex flex-row gap-2 items-start min-h-[20px] leading-normal mb-2",
									todo.status === "in_progress" && "text-vscode-charts-yellow",
									todo.status !== "in_progress" && todo.status !== "completed" && "text-vscode-descriptionForeground",
								)}>
								{icon}
								<span>{todo.content}</span>
							</li>
						)
					})}
				</ul>
			)}
		</div>
	)
}
