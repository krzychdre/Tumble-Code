// npx vitest run __tests__/delegation-events.spec.ts

import { TumbleCodeEventName, tumbleCodeEventsSchema, taskEventSchema } from "@tumble-code/types"

describe("delegation event schemas", () => {
	test("tumbleCodeEventsSchema validates tuples", () => {
		expect(() =>
			(tumbleCodeEventsSchema.shape as any)[TumbleCodeEventName.TaskDelegated].parse(["p", "c"]),
		).not.toThrow()
		expect(() =>
			(tumbleCodeEventsSchema.shape as any)[TumbleCodeEventName.TaskDelegationCompleted].parse(["p", "c", "s"]),
		).not.toThrow()
		expect(() =>
			(tumbleCodeEventsSchema.shape as any)[TumbleCodeEventName.TaskDelegationResumed].parse(["p", "c"]),
		).not.toThrow()

		// invalid shapes
		expect(() => (tumbleCodeEventsSchema.shape as any)[TumbleCodeEventName.TaskDelegated].parse(["p"])).toThrow()
		expect(() =>
			(tumbleCodeEventsSchema.shape as any)[TumbleCodeEventName.TaskDelegationCompleted].parse(["p", "c"]),
		).toThrow()
		expect(() =>
			(tumbleCodeEventsSchema.shape as any)[TumbleCodeEventName.TaskDelegationResumed].parse(["p"]),
		).toThrow()
	})

	test("taskEventSchema discriminated union includes delegation events", () => {
		expect(() =>
			taskEventSchema.parse({
				eventName: TumbleCodeEventName.TaskDelegated,
				payload: ["p", "c"],
				taskId: 1,
			}),
		).not.toThrow()

		expect(() =>
			taskEventSchema.parse({
				eventName: TumbleCodeEventName.TaskDelegationCompleted,
				payload: ["p", "c", "s"],
				taskId: 1,
			}),
		).not.toThrow()

		expect(() =>
			taskEventSchema.parse({
				eventName: TumbleCodeEventName.TaskDelegationResumed,
				payload: ["p", "c"],
				taskId: 1,
			}),
		).not.toThrow()
	})
})
