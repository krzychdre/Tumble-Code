/**
 * The abort controller of one provider request, tied to the task's signal.
 *
 * The task passes the signal of its per-request controller in the request metadata
 * (`ApiHandlerCreateMessageMetadata.signal`); Stop aborts it. Handlers that also keep a
 * controller of their own (so that `cancelRequest()` can abort it) create it here, so the
 * SDK call gets one signal that fires for either reason. The link is dropped when this
 * controller aborts first, so a signal that outlives the request keeps no dead listener.
 */
export function createRequestAbortController(taskSignal?: AbortSignal): AbortController {
	const controller = new AbortController()
	if (!taskSignal) {
		return controller
	}
	if (taskSignal.aborted) {
		controller.abort(taskSignal.reason)
		return controller
	}

	const onTaskAbort = () => controller.abort(taskSignal.reason)
	taskSignal.addEventListener("abort", onTaskAbort, { once: true })
	controller.signal.addEventListener("abort", () => taskSignal.removeEventListener("abort", onTaskAbort), {
		once: true,
	})
	return controller
}
