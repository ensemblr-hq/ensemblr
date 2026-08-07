import type { DatabaseSync } from 'node:sqlite';
import type { AgentSessionEventWire } from '../../../shared/ipc/contracts/agent-session';
import type {
	AgentEventRow,
	AgentSessionRow,
	ChatTabRow,
} from '../../storage/repositories';
import {
	getChatTabById,
	listOpenChatTabs,
	setChatTabMetadata,
} from '../../storage/repositories/chat-tab-repository.ts';
import type { AgentSessionSnapshot } from '../agent-session-types.ts';
import type { WriteSessionSummaryResult } from '../session-summary-writer.ts';

/**
 * Snapshot projection used by both the lifecycle and the composition root.
 *
 * `openedTabs` may be pre-fetched by the caller to amortize the workspace-tabs
 * query across a multi-snapshot listing (avoids an N+1 in
 * `listSessionsForWorkspace`). When omitted, the tabs are fetched from the
 * database for the snapshot's workspace.
 */
export function toSnapshot({
	branchId,
	database,
	openedTabs,
	row,
	runtimeOpen = false,
}: {
	branchId: string;
	database: DatabaseSync;
	openedTabs?: readonly ChatTabRow[];
	row: AgentSessionRow;
	runtimeOpen?: boolean;
}): AgentSessionSnapshot {
	return {
		branchId,
		closedAt: row.closedAt,
		createdAt: row.createdAt,
		cwd: row.cwd,
		id: row.id,
		label: row.label,
		model: row.model,
		openedTabs:
			openedTabs ??
			listOpenChatTabs({ database, workspaceId: row.workspaceId }),
		provider: row.provider,
		runtimeOpen,
		runtimeSessionId: row.runtimeSessionId,
		status: row.status,
		thinkingLevel: row.thinkingLevel,
		updatedAt: row.updatedAt,
		workspaceId: row.workspaceId,
	};
}

/** Converts a persisted event row into the renderer/session-summary wire shape. */
export function toEventWire(row: AgentEventRow): AgentSessionEventWire {
	return {
		branchId: row.branchId,
		createdAt: row.createdAt,
		eventType: row.eventType,
		id: row.id,
		ordinal: row.ordinal,
		payload: row.payload,
		stream: row.stream,
		turnId: row.turnId,
	};
}

/** Stores summary file metadata on the owning chat tab for later history views. */
export function persistSummaryMetadata({
	database,
	result,
	tabId,
}: {
	database: DatabaseSync;
	result: WriteSessionSummaryResult;
	tabId: string;
}): void {
	const tab = getChatTabById({ database, id: tabId });
	if (!tab) {
		return;
	}
	const nextMetadata = {
		...tab.metadata,
		summary: {
			path: result.path,
			source: result.source,
			title: result.title,
		},
	};
	setChatTabMetadata({ database, id: tabId, metadata: nextMetadata });
}
