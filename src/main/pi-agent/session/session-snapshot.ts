import type { DatabaseSync } from 'node:sqlite';
import type { PiSessionEventWire } from '../../../shared/ipc';
import {
	type ChatTabRow,
	getChatTabById,
	listOpenChatTabs,
	setChatTabMetadata,
} from '../../storage/repositories/chat-tab-repository.ts';
import type { PiEventRow } from '../../storage/repositories/pi-event-repository.ts';
import type { PiSessionRow } from '../../storage/repositories/pi-session-repository.ts';
import type { PiSessionSnapshot } from '../pi-session-types.ts';
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
	row: PiSessionRow;
	runtimeOpen?: boolean;
}): PiSessionSnapshot {
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
		piSessionId: row.piSessionId,
		runtimeOpen,
		status: row.status,
		thinkingLevel: row.thinkingLevel,
		updatedAt: row.updatedAt,
		workspaceId: row.workspaceId,
	};
}

/** Converts a persisted event row into the renderer/session-summary wire shape. */
export function toEventWire(row: PiEventRow): PiSessionEventWire {
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
			title: result.title,
			usedLlm: result.usedLlm,
		},
	};
	setChatTabMetadata({ database, id: tabId, metadata: nextMetadata });
}
