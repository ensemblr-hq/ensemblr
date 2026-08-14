/**
 * Gives a planning workspace a name drawn from the user's first prompt, so the
 * board stops showing a generated placeholder while the agent reads, interviews,
 * and writes a plan.
 *
 * The counterpart to `session-naming.ts`, which does the same for a chat tab's
 * title. Both are deliberately dumb and instant — no model runs, so a slow or
 * unreachable provider can never leave a workspace unlabeled — and both yield
 * the moment somebody chooses a real name. This one goes through
 * {@link applyBranchSlug} rather than the rename service directly, so the
 * setting gate, the adopted-branch refusal, and the race re-check are the same
 * ones the agent's own `ensemblr_set_branch_name` passes through.
 *
 * It runs only while planning. Outside Plan Mode an agent names the workspace on
 * its first turn anyway, and guessing ahead of it would spend a branch move to
 * beat it by seconds.
 */

import type { RenameWorkspaceService } from '../../repository';
import type { EnsemblrDatabaseService } from '../../storage';
import { getChatTabByAgentSessionId } from '../../storage/repositories/chat-tab-repository.ts';
import { applyBranchSlug } from './apply-branch-slug.ts';
import { deriveProvisionalBranchSlug } from './provisional-branch-slug.ts';

/** One provisional-naming attempt, built from a session open or a prompt submit. */
export interface ProvisionalNamingInput {
	/** The user's prompt, which the slug describes. */
	prompt: string;
	sessionId: string;
	/** The session's workspace when the caller knows it; resolved from the tab otherwise. */
	workspaceId: string | null;
}

/** Fire-and-forget queue for provisional workspace naming. */
export type QueueProvisionalNamingPort = (
	input: ProvisionalNamingInput,
) => void;

/**
 * Builds the queue that names a planning workspace from its first prompt.
 * Callers fire it and move on: naming is bookkeeping, and a failure here must
 * never delay or fail the turn that triggered it. An in-flight guard keyed by
 * session drops the overlap between the open-time fire and the first submit.
 * @param options - The database service, the user's naming setting, the rename service, and a callback to refresh the UI once a name lands.
 * @returns A fire-and-forget `queueProvisionalNaming(input)` to call from open and submit.
 */
export function createProvisionalWorkspaceNaming({
	databaseService,
	namingEnabled,
	onRenamed,
	renameWorkspace,
}: {
	databaseService: EnsemblrDatabaseService;
	namingEnabled: () => boolean;
	/**
	 * Announces a landed rename so the windows showing this workspace catch up.
	 * Takes the session as well as the workspace because the sidebar's name comes
	 * from a cached navigation query that only the session's `workspace-renamed`
	 * timeline event invalidates.
	 */
	onRenamed: (renamed: { sessionId: string; workspaceId: string }) => void;
	renameWorkspace: RenameWorkspaceService['rename'];
}): QueueProvisionalNamingPort {
	const inFlight = new Set<string>();
	return (input) => {
		if (inFlight.has(input.sessionId)) {
			return;
		}
		inFlight.add(input.sessionId);
		void runProvisionalNaming({
			databaseService,
			input,
			namingEnabled,
			onRenamed,
			renameWorkspace,
		})
			.catch((cause: unknown) => {
				console.warn('[agent-session] provisional workspace naming failed', {
					cause: cause instanceof Error ? cause.message : String(cause),
					sessionId: input.sessionId,
				});
			})
			.finally(() => {
				inFlight.delete(input.sessionId);
			});
	};
}

/** Runs one gated attempt: derive the slug, then apply it as a provisional name. */
async function runProvisionalNaming({
	databaseService,
	input,
	namingEnabled,
	onRenamed,
	renameWorkspace,
}: {
	databaseService: EnsemblrDatabaseService;
	input: ProvisionalNamingInput;
	namingEnabled: () => boolean;
	onRenamed: (renamed: { sessionId: string; workspaceId: string }) => void;
	renameWorkspace: RenameWorkspaceService['rename'];
}): Promise<void> {
	if (!namingEnabled()) {
		return;
	}
	const database = databaseService.getConnection()?.database;
	if (!database) {
		return;
	}
	const workspaceId =
		input.workspaceId ??
		getChatTabByAgentSessionId({
			database,
			agentSessionId: input.sessionId,
		})?.workspaceId ??
		null;
	if (!workspaceId) {
		return;
	}
	const slug = deriveProvisionalBranchSlug(input.prompt);
	if (!slug) {
		return;
	}
	const result = await applyBranchSlug({
		database,
		name: slug,
		namingEnabled: true,
		provisional: true,
		renameWorkspace,
		workspaceId,
	});
	if (result.applied) {
		onRenamed({ sessionId: input.sessionId, workspaceId });
	}
}
