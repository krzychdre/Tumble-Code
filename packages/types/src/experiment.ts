import { z } from "zod"

import type { Keys, Values, Equals, AssertEqual } from "./type-fu.js"

/**
 * ExperimentId
 */

export const experimentIds = [
	"preventFocusDisruption",
	"imageGeneration",
	"runSlashCommand",
	"customTools",
	"deferredTools",
] as const

export const experimentIdsSchema = z.enum(experimentIds)

export type ExperimentId = z.infer<typeof experimentIdsSchema>

/**
 * Experiments
 */

export const experimentsSchema = z.object({
	preventFocusDisruption: z.boolean().optional(),
	imageGeneration: z.boolean().optional(),
	runSlashCommand: z.boolean().optional(),
	customTools: z.boolean().optional(),
	deferredTools: z.boolean().optional(),
})

export type Experiments = z.infer<typeof experimentsSchema>

type _AssertExperiments = AssertEqual<Equals<ExperimentId, Keys<Experiments>>>

/**
 * Experiment flags: the ids by key, their defaults and a lookup helper
 * (moved from src/shared/experiments.ts, PKG-6).
 */

export const EXPERIMENT_IDS = {
	PREVENT_FOCUS_DISRUPTION: "preventFocusDisruption",
	IMAGE_GENERATION: "imageGeneration",
	RUN_SLASH_COMMAND: "runSlashCommand",
	CUSTOM_TOOLS: "customTools",
	DEFERRED_TOOLS: "deferredTools",
} as const satisfies Record<string, ExperimentId>

type _AssertExperimentIds = AssertEqual<Equals<ExperimentId, Values<typeof EXPERIMENT_IDS>>>

export type ExperimentKey = Keys<typeof EXPERIMENT_IDS>

export interface ExperimentConfig {
	enabled: boolean
}

export const experimentConfigsMap: Record<ExperimentKey, ExperimentConfig> = {
	PREVENT_FOCUS_DISRUPTION: { enabled: false },
	IMAGE_GENERATION: { enabled: false },
	RUN_SLASH_COMMAND: { enabled: false },
	CUSTOM_TOOLS: { enabled: false },
	DEFERRED_TOOLS: { enabled: false },
}

export const experimentDefault = Object.fromEntries(
	Object.entries(experimentConfigsMap).map(([_, config]) => [
		EXPERIMENT_IDS[_ as keyof typeof EXPERIMENT_IDS] as ExperimentId,
		config.enabled,
	]),
) as Record<ExperimentId, boolean>

export const experiments = {
	get: (id: ExperimentKey): ExperimentConfig | undefined => experimentConfigsMap[id],
	isEnabled: (experimentsConfig: Experiments, id: ExperimentId) => experimentsConfig[id] ?? experimentDefault[id],
} as const
