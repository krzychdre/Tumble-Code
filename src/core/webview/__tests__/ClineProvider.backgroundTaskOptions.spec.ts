import { describe, it, expect, vi, beforeEach } from "vitest"

import type { OrganizationAllowList, ProviderSettings } from "@roo-code/types"

import { ClineProvider } from "../ClineProvider"
import { Task } from "../../task/Task"
import { OrganizationAllowListViolationError } from "../../../utils/errors"

/**
 * DEF-C6: a background task (parallel subagent or memory writer) must be
 * created under the same profile rules as a foreground task: the organization
 * allow list is enforced and the profile's consecutive-mistake limit is
 * passed to the Task. The test drives the real `createBackgroundTask` on an
 * object whose prototype is ClineProvider, with only the collaborators the
 * method touches stubbed, and a mocked Task constructor that records its
 * options.
 */

vi.mock("../../task/Task", () => ({
	Task: vi.fn().mockImplementation((options: Record<string, unknown>) => ({
		taskId: "bg-task",
		instanceId: "1",
		options,
		start: vi.fn(),
	})),
}))

const ALLOW_ONLY_ANTHROPIC: OrganizationAllowList = {
	allowAll: false,
	providers: { anthropic: { allowAll: true } },
}

const ALLOWED_PROFILE: ProviderSettings = {
	apiProvider: "anthropic",
	apiModelId: "claude-sonnet-4-5",
	consecutiveMistakeLimit: 7,
}

const DISALLOWED_PROFILE: ProviderSettings = {
	apiProvider: "openrouter",
	openRouterModelId: "some/model",
	consecutiveMistakeLimit: 7,
}

function makeProvider(opts: {
	activeProfile: ProviderSettings
	organizationAllowList?: OrganizationAllowList
	modeProfile?: { name: string; apiConfiguration: ProviderSettings }
}) {
	const provider = Object.create(ClineProvider.prototype) as ClineProvider
	const register = vi.fn()
	Object.assign(provider, {
		getState: vi.fn(async () => ({
			apiConfiguration: opts.activeProfile,
			currentApiConfigName: "active",
			organizationAllowList: opts.organizationAllowList ?? { allowAll: true, providers: {} },
			experiments: {},
			mode: "code",
		})),
		getApiConfigurationForMode: vi.fn(async () => opts.modeProfile),
		backgroundTasks: new Map(),
		subagentRegistry: { register },
		log: vi.fn(),
		taskCreationCallback: vi.fn(),
	})
	return { provider, register }
}

function lastTaskOptions(): Record<string, unknown> {
	const calls = vi.mocked(Task).mock.calls
	return calls[calls.length - 1][0] as unknown as Record<string, unknown>
}

describe("ClineProvider.createBackgroundTask profile rules (DEF-C6)", () => {
	beforeEach(() => {
		vi.mocked(Task).mockClear()
	})

	it("rejects a subagent whose mode-pinned profile is not on the organization allow list", async () => {
		const { provider, register } = makeProvider({
			activeProfile: ALLOWED_PROFILE,
			organizationAllowList: ALLOW_ONLY_ANTHROPIC,
			modeProfile: { name: "pinned", apiConfiguration: DISALLOWED_PROFILE },
		})

		await expect(
			provider.createBackgroundTask("do work", {
				taskMode: "code",
				subagentInfo: { parentTaskId: "parent", index: 0, description: "do work" },
			}),
		).rejects.toBeInstanceOf(OrganizationAllowListViolationError)

		// Nothing was spawned or registered: the check runs before the Task exists.
		expect(Task).not.toHaveBeenCalled()
		expect(register).not.toHaveBeenCalled()
		expect((provider as unknown as { backgroundTasks: Map<string, unknown> }).backgroundTasks.size).toBe(0)
	})

	it("rejects a background task given an explicit disallowed profile (memory writer path)", async () => {
		const { provider } = makeProvider({
			activeProfile: ALLOWED_PROFILE,
			organizationAllowList: ALLOW_ONLY_ANTHROPIC,
		})

		await expect(
			provider.createBackgroundTask("extract memories", { apiConfiguration: DISALLOWED_PROFILE }),
		).rejects.toBeInstanceOf(OrganizationAllowListViolationError)
		expect(Task).not.toHaveBeenCalled()
	})

	it("starts a background task on an allowed profile", async () => {
		const { provider } = makeProvider({
			activeProfile: ALLOWED_PROFILE,
			organizationAllowList: ALLOW_ONLY_ANTHROPIC,
		})

		const task = await provider.createBackgroundTask("do work")

		expect(Task).toHaveBeenCalledTimes(1)
		expect(lastTaskOptions().apiConfiguration).toBe(ALLOWED_PROFILE)
		expect(task.start).toHaveBeenCalled()
	})

	it("passes the resolved profile's consecutive-mistake limit to the Task", async () => {
		const pinned: ProviderSettings = { ...ALLOWED_PROFILE, consecutiveMistakeLimit: 11 }
		const { provider } = makeProvider({
			activeProfile: ALLOWED_PROFILE,
			modeProfile: { name: "pinned", apiConfiguration: pinned },
		})

		await provider.createBackgroundTask("do work", {
			taskMode: "code",
			subagentInfo: { parentTaskId: "parent", index: 0, description: "do work" },
		})

		// The limit follows the profile the subagent actually runs on (the
		// mode-pinned one), not the foreground profile.
		expect(lastTaskOptions().consecutiveMistakeLimit).toBe(11)
	})

	it("passes the active profile's consecutive-mistake limit when no profile is pinned", async () => {
		const { provider } = makeProvider({ activeProfile: ALLOWED_PROFILE })

		await provider.createBackgroundTask("do work")

		expect(lastTaskOptions().consecutiveMistakeLimit).toBe(7)
	})
})
