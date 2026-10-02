import type { DatabaseSync } from 'node:sqlite';

import type { AgentSessionLineage } from '../../shared/agent-control.ts';
import {
	getAgentSessionById,
	listAgentSessionsByWorkspace,
	updateAgentSession,
} from '../storage/repositories/agent-session-repository.ts';
import {
	getChatTabByAgentSessionId,
	getChatTabById,
} from '../storage/repositories/chat-tab-repository.ts';

/** Metadata key holding the versioned durable lineage record. */
const AGENT_SESSION_LINEAGE_METADATA_KEY = 'lineage';

/** Version written for durable lineage records. */
const LINEAGE_VERSION = 1;

/** A persisted, verified lineage record stored inside session metadata. */
interface PersistedAgentSessionLineage extends AgentSessionLineage {
	harnessRoot: boolean;
	version: typeof LINEAGE_VERSION;
	rootSessionId: string;
}

/** Conservative identity used whenever ancestry cannot be proved. */
const UNPROVEN_LINEAGE: AgentSessionLineage = {
	depth: 2,
	parentSessionId: null,
	rootSessionId: null,
};

/** Reports whether an unknown value is a non-null object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Drops the storage-only version field from a validated record. */
function toPublicLineage(
	lineage: PersistedAgentSessionLineage,
): AgentSessionLineage {
	return {
		depth: lineage.depth,
		parentSessionId: lineage.parentSessionId,
		rootSessionId: lineage.rootSessionId,
	};
}

/** Parses the versioned lineage metadata without trusting partial shapes. */
function parsePersistedLineage(
	value: unknown,
): PersistedAgentSessionLineage | null {
	if (!isRecord(value) || value.version !== LINEAGE_VERSION) {
		return null;
	}
	if (
		(value.depth !== 0 && value.depth !== 1 && value.depth !== 2) ||
		typeof value.rootSessionId !== 'string' ||
		(value.parentSessionId !== null &&
			typeof value.parentSessionId !== 'string')
	) {
		return null;
	}
	if (value.harnessRoot !== undefined && value.harnessRoot !== true) {
		return null;
	}
	return {
		depth: value.depth,
		harnessRoot: value.harnessRoot === true,
		parentSessionId: value.parentSessionId,
		rootSessionId: value.rootSessionId,
		version: LINEAGE_VERSION,
	};
}

/** Writes a verified record while preserving unrelated session metadata. */
function persistLineage({
	database,
	lineage,
	sessionId,
}: {
	database: DatabaseSync;
	lineage: AgentSessionLineage & {
		harnessRoot?: true;
		rootSessionId: string;
	};
	sessionId: string;
}): void {
	const row = getAgentSessionById({ database, id: sessionId });
	if (!row) {
		throw new Error(`Agent session ${sessionId} does not exist.`);
	}
	updateAgentSession({
		database,
		id: sessionId,
		patch: {
			metadata: {
				...row.metadata,
				[AGENT_SESSION_LINEAGE_METADATA_KEY]: {
					...lineage,
					version: LINEAGE_VERSION,
				},
			},
		},
	});
}

/** Resolves and optionally persists a provable legacy tab-parent lineage. */
function resolveLegacyLineage({
	database,
	sessionId,
	seen,
}: {
	database: DatabaseSync;
	sessionId: string;
	seen: Set<string>;
}): AgentSessionLineage {
	const row = getAgentSessionById({ database, id: sessionId });
	if (!row) {
		return UNPROVEN_LINEAGE;
	}
	const tab = getChatTabByAgentSessionId({
		agentSessionId: sessionId,
		database,
	});
	if (!tab) {
		return UNPROVEN_LINEAGE;
	}
	const role = tab.metadata.agentRole;
	const parentTabId = tab.metadata.parentChatTabId;
	const hasParentTabId =
		typeof parentTabId === 'string' && parentTabId.length > 0;
	if (!hasParentTabId) {
		if (role !== undefined && role !== null) {
			return UNPROVEN_LINEAGE;
		}
		const lineage = {
			depth: 0 as const,
			parentSessionId: null,
			rootSessionId: sessionId,
		};
		persistLineage({ database, lineage, sessionId });
		return lineage;
	}
	const parentTab = getChatTabById({ database, id: parentTabId });
	if (
		!parentTab?.agentSessionId ||
		parentTab.workspaceId !== row.workspaceId ||
		seen.has(parentTab.agentSessionId)
	) {
		return UNPROVEN_LINEAGE;
	}
	const parent = resolveLineage({
		database,
		seen,
		sessionId: parentTab.agentSessionId,
	});
	if (parent.rootSessionId === null || parent.depth >= 2) {
		return UNPROVEN_LINEAGE;
	}
	const lineage = {
		depth: (parent.depth + 1) as 1 | 2,
		parentSessionId: parentTab.agentSessionId,
		rootSessionId: parent.rootSessionId,
	};
	persistLineage({ database, lineage, sessionId });
	return lineage;
}

/** Validates one parsed record against its parent row and resolved chain. */
function validatePersistedLineage({
	database,
	rowWorkspaceId,
	seen,
	sessionId,
	stored,
}: {
	database: DatabaseSync;
	rowWorkspaceId: string;
	seen: Set<string>;
	sessionId: string;
	stored: PersistedAgentSessionLineage;
}): AgentSessionLineage {
	if (stored.depth === 0) {
		return !stored.harnessRoot &&
			stored.parentSessionId === null &&
			stored.rootSessionId === sessionId
			? toPublicLineage(stored)
			: UNPROVEN_LINEAGE;
	}
	if (
		stored.depth === 1 &&
		stored.harnessRoot &&
		stored.parentSessionId === `ws:${rowWorkspaceId}` &&
		stored.rootSessionId === stored.parentSessionId
	) {
		return toPublicLineage(stored);
	}
	if (!stored.parentSessionId || stored.parentSessionId === sessionId) {
		return UNPROVEN_LINEAGE;
	}
	const parentRow = getAgentSessionById({
		database,
		id: stored.parentSessionId,
	});
	if (!parentRow || parentRow.workspaceId !== rowWorkspaceId) {
		return UNPROVEN_LINEAGE;
	}
	const parent = resolveLineage({
		database,
		seen,
		sessionId: stored.parentSessionId,
	});
	const parentStored = parsePersistedLineage(
		parentRow.metadata[AGENT_SESSION_LINEAGE_METADATA_KEY],
	);
	return parent.rootSessionId !== null &&
		parent.depth < 2 &&
		stored.depth === parent.depth + 1 &&
		stored.rootSessionId === parent.rootSessionId &&
		stored.harnessRoot === (parentStored?.harnessRoot ?? false)
		? toPublicLineage(stored)
		: UNPROVEN_LINEAGE;
}

/** Recursively validates persisted lineage against the same-workspace chain. */
function resolveLineage({
	database,
	sessionId,
	seen,
}: {
	database: DatabaseSync;
	sessionId: string;
	seen: Set<string>;
}): AgentSessionLineage {
	if (seen.has(sessionId)) {
		return UNPROVEN_LINEAGE;
	}
	const row = getAgentSessionById({ database, id: sessionId });
	if (!row) {
		return UNPROVEN_LINEAGE;
	}
	const nextSeen = new Set(seen).add(sessionId);
	if (!(AGENT_SESSION_LINEAGE_METADATA_KEY in row.metadata)) {
		return resolveLegacyLineage({ database, seen: nextSeen, sessionId });
	}
	const stored = parsePersistedLineage(
		row.metadata[AGENT_SESSION_LINEAGE_METADATA_KEY],
	);
	return stored
		? validatePersistedLineage({
				database,
				rowWorkspaceId: row.workspaceId,
				seen: nextSeen,
				sessionId,
				stored,
			})
		: UNPROVEN_LINEAGE;
}

/**
 * Resolves a session's durable lineage and validates every ancestor against the
 * database. Provable legacy roots and tab-linked descendants are upgraded to a
 * version-1 metadata record; malformed, cyclic, missing, or cross-workspace
 * ancestry returns a null-root depth-2 identity so authority fails closed.
 * @param input - Open database and Ensemblr session id to resolve.
 * @returns Validated lineage, or the conservative unproven identity.
 */
export function resolveAgentSessionLineage({
	database,
	sessionId,
}: {
	database: DatabaseSync;
	sessionId: string;
}): AgentSessionLineage {
	return resolveLineage({ database, seen: new Set(), sessionId });
}

/**
 * Establishes lineage for a freshly created session from a trusted internal
 * parent id. Parentless sessions become verified roots; an unverified parent or
 * a parent already at depth 2 is rejected before a runtime can start.
 * @param input - Open database, new session id, trusted parent id, and its internal species.
 * @returns The verified lineage persisted on the new session.
 */
export function establishAgentSessionLineage({
	database,
	parentSessionId = null,
	parentSpecies,
	sessionId,
}: {
	database: DatabaseSync;
	parentSessionId?: string | null;
	parentSpecies?: 'harness';
	sessionId: string;
}): AgentSessionLineage {
	const row = getAgentSessionById({ database, id: sessionId });
	if (!row) {
		throw new Error(`Agent session ${sessionId} does not exist.`);
	}
	if (!parentSessionId) {
		const lineage = {
			depth: 0 as const,
			parentSessionId: null,
			rootSessionId: sessionId,
		};
		persistLineage({ database, lineage, sessionId });
		return lineage;
	}
	if (
		parentSpecies === 'harness' &&
		parentSessionId === `ws:${row.workspaceId}`
	) {
		const lineage = {
			depth: 1 as const,
			harnessRoot: true as const,
			parentSessionId,
			rootSessionId: parentSessionId,
		};
		persistLineage({ database, lineage, sessionId });
		return toPublicLineage({ ...lineage, version: LINEAGE_VERSION });
	}
	const parentRow = getAgentSessionById({ database, id: parentSessionId });
	const parent = resolveAgentSessionLineage({
		database,
		sessionId: parentSessionId,
	});
	if (
		!parentRow ||
		parentRow.workspaceId !== row.workspaceId ||
		parent.rootSessionId === null ||
		parent.depth >= 2
	) {
		throw new Error('Cannot establish agent session lineage from this parent.');
	}
	const parentStored = parsePersistedLineage(
		parentRow.metadata[AGENT_SESSION_LINEAGE_METADATA_KEY],
	);
	const lineage = {
		depth: (parent.depth + 1) as 1 | 2,
		...(parentStored?.harnessRoot ? { harnessRoot: true as const } : {}),
		parentSessionId,
		rootSessionId: parent.rootSessionId,
	};
	persistLineage({ database, lineage, sessionId });
	return {
		depth: lineage.depth,
		parentSessionId: lineage.parentSessionId,
		rootSessionId: lineage.rootSessionId,
	};
}

/**
 * Lists validated immediate children from persisted session rows, including
 * idle and closed descendants whose origins are absent from the live registry.
 * @param input - Open database and parent Ensemblr session id.
 * @returns Same-workspace child session ids in repository order.
 */
export function listImmediateAgentSessionChildren({
	database,
	parentSessionId,
}: {
	database: DatabaseSync;
	parentSessionId: string;
}): readonly string[] {
	const parent = getAgentSessionById({ database, id: parentSessionId });
	const workspaceId =
		parent?.workspaceId ??
		(parentSessionId.startsWith('ws:') ? parentSessionId.slice(3) : null);
	if (!workspaceId) {
		return [];
	}
	const children: string[] = [];
	for (const row of listAgentSessionsByWorkspace({
		database,
		workspaceId,
	})) {
		if (
			resolveAgentSessionLineage({ database, sessionId: row.id })
				.parentSessionId === parentSessionId
		) {
			children.push(row.id);
		}
	}
	return children;
}
