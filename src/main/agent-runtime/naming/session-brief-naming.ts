/**
 * What naming upkeep a caller still owes at the start of a turn: whether its tab
 * still carries a title the app guessed, whether the summary on file has fallen
 * behind the branch, and whether the workspace may still be named.
 *
 * The rules live here rather than in the agent-control adapter so the eligibility,
 * provenance, and staleness decisions are unit-testable on their own. The module
 * takes an open database, the caller's identity, and a reader for the resolved
 * `git.renameWorkspaceOnBranch` setting — never the adapter's dependency bag — so
 * nothing about the control ports, the agent session service, or the app-settings
 * service crosses the boundary. The setting arrives as a reader rather than a
 * boolean because it is backed by a file read: taking it lazily keeps a settings
 * failure inside this module's own degrade-quietly guard, where every other
 * lookup here already lives.
 */

import type { DatabaseSync } from 'node:sqlite';

import type { SessionBriefNaming } from '../../../shared/agent-control.ts';
import { parseMetadata } from '../../repository/metadata.ts';
import { getMaxOrdinalForBranch } from '../../storage/repositories/agent-event-repository.ts';
import { getMainBranchForSession } from '../../storage/repositories/agent-session-repository.ts';
import { getChatTabByAgentSessionId } from '../../storage/repositories/chat-tab-repository.ts';
import { selectWorkspaceWithRepositoryById } from '../../storage/repositories/workspace-repository.ts';
import { readAgentSummaryMarker } from '../agent-summary.ts';
import { isWorkspaceNameable } from '../branch-name-slug.ts';

/**
 * The caller fields the brief consults, satisfied structurally by a resolved
 * agent-control origin plus the caller's resolved role. Only a caller that owns a
 * chat tab has a conversation branch, so title and summary upkeep are read for
 * those alone, and only a root may name the workspace, so `isSubAgent` gates the
 * branch bullet.
 */
export interface SessionBriefCaller {
	/** Whether the caller drives a native chat tab rather than a terminal tab. */
	hasChatTab: boolean;
	sessionId: string;
	workspaceId: string;
	isSubAgent: boolean;
}

/**
 * Builds the brief for a caller that owes nothing. Rebuilt per call so a
 * consumer holding the result can never write through to a shared default.
 * @returns A brief with no outstanding upkeep.
 */
function nothingOutstanding(): SessionBriefNaming {
	return {
		branch: { current: null, eligible: false },
		summaryStale: false,
		titleNeeded: false,
	};
}

/**
 * Reads what naming upkeep a caller still owes. Best-effort throughout: the
 * brief runs on every agent start, so a caller whose tab, branch, workspace, or
 * settings file cannot be read reports nothing outstanding rather than failing
 * the turn's system prompt.
 * @param input - The open database (null when storage is down), the caller's identity, and a reader for the workspace-naming setting.
 * @returns The caller's outstanding naming upkeep.
 */
export function readSessionBriefNaming({
	caller,
	database,
	namingEnabled,
}: {
	caller: SessionBriefCaller;
	database: DatabaseSync | null | undefined;
	namingEnabled: () => boolean;
}): SessionBriefNaming {
	if (!database) {
		return nothingOutstanding();
	}
	try {
		const workspaceNaming = readWorkspaceNaming({
			database,
			namingEnabled,
			workspaceId: caller.workspaceId,
		});
		// Withholding eligibility is what stops the upkeep block asking a child for
		// a `setBranchName` call the role policy refuses.
		const branch = caller.isSubAgent
			? { ...workspaceNaming, eligible: false }
			: workspaceNaming;
		if (!caller.hasChatTab) {
			return { ...nothingOutstanding(), branch };
		}
		const tab = getChatTabByAgentSessionId({
			database,
			agentSessionId: caller.sessionId,
		});
		const sessionBranch = getMainBranchForSession({
			database,
			agentSessionId: caller.sessionId,
		});
		if (!tab || !sessionBranch) {
			return { ...nothingOutstanding(), branch };
		}
		return {
			branch,
			summaryStale: isSummaryStale({
				branchId: sessionBranch.id,
				database,
				metadata: tab.metadata,
			}),
			titleNeeded: !titleIsOwned(tab.metadata),
		};
	} catch (cause) {
		console.warn('[agent-control] session brief naming read failed.', {
			cause: cause instanceof Error ? cause.message : String(cause),
			sessionId: caller.sessionId,
			workspaceId: caller.workspaceId,
		});
		return nothingOutstanding();
	}
}

/**
 * Reads a workspace's branch and whether the agent may still name it: the
 * workspace must still carry its generated placeholder name *and* the user must
 * not have turned workspace/branch naming off.
 * @param input - The open database, the naming-setting reader, and the workspace to read.
 * @returns The workspace's current branch and its naming eligibility.
 */
function readWorkspaceNaming({
	database,
	namingEnabled,
	workspaceId,
}: {
	database: DatabaseSync;
	namingEnabled: () => boolean;
	workspaceId: string;
}): SessionBriefNaming['branch'] {
	const row = selectWorkspaceWithRepositoryById({ database, workspaceId }) as
		| Record<string, unknown>
		| undefined;
	if (!row) {
		return { current: null, eligible: false };
	}
	const nameable =
		isWorkspaceNameable(parseMetadata(String(row.metadataJson ?? ''))) &&
		namingEnabled();
	return {
		current: typeof row.branchName === 'string' ? row.branchName : null,
		eligible: nameable,
	};
}

/**
 * Reports whether a tab's title has been claimed by the agent or the user, as
 * opposed to still being the one the app derived from the first prompt.
 * @param metadata - The chat tab's untyped metadata blob.
 * @returns True once someone has chosen the title.
 */
function titleIsOwned(metadata: Record<string, unknown>): boolean {
	const provenance = metadata.titleProvenance;
	return provenance === 'agent' || provenance === 'user';
}

/**
 * Reports whether the branch has advanced past the agent's recorded summary. A
 * summary written for a different branch (a reused tab) never counts, so the
 * agent is asked for a fresh one.
 * @param input - The branch to measure against, the open database, and the tab's metadata blob.
 * @returns True when the tab owes a new summary.
 */
function isSummaryStale({
	branchId,
	database,
	metadata,
}: {
	branchId: string;
	database: DatabaseSync;
	metadata: Record<string, unknown>;
}): boolean {
	const marker = readAgentSummaryMarker(metadata);
	if (!marker || marker.branchId !== branchId) {
		return true;
	}
	return (
		marker.capturedAtOrdinal < getMaxOrdinalForBranch({ branchId, database })
	);
}
