import { CloudService, type RecallFolder, type RecallScope } from "@tumble-code/cloud"

import { getGitRepositoryInfo } from "../../utils/git"

/** How long a folder's recall scope is trusted before a model request asks the cloud again. */
export const RECALL_SCOPE_TTL_MS = 5 * 60_000

/** The signed-in user and tenant a scope was learned for; the same folder can differ in another tenant. */
export interface RecallIdentity {
	userId: string | undefined
	organizationId: string | null
}

/** The folder as the recall API names it: the path, and the git remote when there is one. */
export async function recallFolder(cwd: string): Promise<RecallFolder> {
	const { repositoryUrl } = await getGitRepositoryInfo(cwd)
	return { workspacePath: cwd, repositoryUrl }
}

/**
 * The recall scope of each folder, asked of the cloud at most once per five minutes per
 * identity and folder. Every model request reads it, so the tool gate follows a sign-out,
 * an organization switch or a scope change without a request of its own each time.
 */
export class RecallScopeCache {
	private readonly entries = new Map<string, { expiresAt: number; scope: Promise<RecallScope | undefined> }>()

	constructor(
		private readonly lookup: (cwd: string) => Promise<RecallScope>,
		private readonly now: () => number = Date.now,
	) {}

	/** Undefined when signed out, or when the cloud did not answer (until the entry expires). */
	scopeFor(identity: RecallIdentity | undefined, cwd: string): Promise<RecallScope | undefined> {
		if (!identity) {
			return Promise.resolve(undefined)
		}
		const key = JSON.stringify([identity.userId, identity.organizationId, cwd])
		const cached = this.entries.get(key)
		if (cached && cached.expiresAt > this.now()) {
			return cached.scope
		}
		const scope = this.lookup(cwd).catch(() => undefined)
		this.entries.set(key, { expiresAt: this.now() + RECALL_SCOPE_TTL_MS, scope })
		return scope
	}
}

function currentIdentity(): RecallIdentity | undefined {
	if (!CloudService.hasInstance() || !CloudService.instance.isAuthenticated()) {
		return undefined
	}
	const cloud = CloudService.instance
	return { userId: cloud.getUserInfo()?.id, organizationId: cloud.getOrganizationId() }
}

const recallScopes = new RecallScopeCache(
	async (cwd) => (await CloudService.instance.cloudAPI!.recallContext(await recallFolder(cwd))).scope,
)

/** The recall scope that gates the recall tools of a request in this folder. */
export function getRecallScope(cwd: string): Promise<RecallScope | undefined> {
	return recallScopes.scopeFor(currentIdentity(), cwd)
}
