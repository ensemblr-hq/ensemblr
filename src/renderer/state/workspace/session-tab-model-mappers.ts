import type { SessionTabModel } from '@/renderer/types/workbench';
import type { AgentSessionSnapshotWire } from '@/shared/ipc/contracts/agent-session';
import type {
	ChatTabWire,
	ClosedChatTabEntryWire,
} from '@/shared/ipc/contracts/chat-tab';
import { parseWorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

import { parseCommentPreview } from './comment-preview-tab';
import { readHarnessSessionId } from './terminal-tab-restore';

/** Shared identity fields every session-tab model carries, derived from the row. */
type SessionTabBaseFields = {
	agentSessionId: string | null;
	chatTabId: string;
	fullLabel: string;
	id: string;
	isPreview: boolean;
	isSubAgent: boolean;
	label: string;
	status: SessionTabModel['status'];
	summary: string;
	updatedLabel: string;
};

/** Reads a metadata field as a string, falling back when it is absent or non-string. */
function metadataString(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

/** Builds the `diff` variant, carrying its optional file path, turn id, and scope. */
function toDiffSessionTab(
	base: SessionTabBaseFields,
	tab: ChatTabWire,
): SessionTabModel {
	const diffScope = parseWorkspaceGitDiffScope(tab.metadata.diffScope);
	return {
		...base,
		...(diffScope ? { diffScope } : {}),
		filePath: metadataString(tab.metadata.filePath, '') || null,
		kind: 'diff',
		turnId: metadataString(tab.metadata.turnId, '') || null,
	};
}

/** Builds the `terminal` variant, carrying its backing PTY id and harness identity. */
function toTerminalSessionTab(
	base: SessionTabBaseFields,
	tab: ChatTabWire,
): SessionTabModel {
	return {
		...base,
		harnessSessionId: readHarnessSessionId(tab.metadata) ?? null,
		harnessId: metadataString(tab.metadata.harnessId, ''),
		harnessLabel: metadataString(tab.metadata.harnessLabel, base.label),
		kind: 'terminal',
		terminalId: metadataString(tab.metadata.terminalId, ''),
	};
}

/** Builds the `document` variant, carrying its optional inline-comment preview. */
function toDocumentSessionTab(
	base: SessionTabBaseFields,
	tab: ChatTabWire,
): SessionTabModel {
	const commentPreview = parseCommentPreview(tab.metadata.commentPreview);
	return {
		...base,
		...(commentPreview ? { commentPreview } : {}),
		filePath: metadataString(tab.metadata.filePath, '') || null,
		kind: 'document',
	};
}

/** Maps an open chat-tab wire row into a renderer-facing `SessionTabModel`. */
export function toSessionTabModel(
	tab: ChatTabWire,
	agentSession: AgentSessionSnapshotWire | undefined,
): SessionTabModel {
	const base: SessionTabBaseFields = {
		agentSessionId: tab.agentSessionId,
		chatTabId: tab.id,
		fullLabel: tab.fullTitle || tab.title,
		id: tab.id,
		isPreview: tab.isPreview,
		isSubAgent: tab.metadata.agentRole === 'subagent',
		label: tab.title,
		status: deriveTabStatus(agentSession),
		summary: '',
		updatedLabel: '',
	};
	switch (tab.kind) {
		case 'chat':
			return { ...base, kind: 'chat' };
		case 'diff':
			return toDiffSessionTab(base, tab);
		case 'terminal':
			return toTerminalSessionTab(base, tab);
		case 'document':
			return toDocumentSessionTab(base, tab);
		default:
			return {
				...base,
				filePath: metadataString(tab.metadata.filePath, '') || null,
				kind: tab.kind,
			};
	}
}

/** Maps an agent session's runtime status to the tab spinner state. */
function deriveTabStatus(
	agentSession: AgentSessionSnapshotWire | undefined,
): SessionTabModel['status'] {
	if (!agentSession?.runtimeOpen) {
		return 'idle';
	}
	if (
		agentSession.status === 'starting' ||
		agentSession.status === 'streaming'
	) {
		return 'working';
	}
	return 'idle';
}

/** Maps a closed-tab + summary entry into a `SessionTabModel`. */
export function toClosedSessionTabModel(
	entry: ClosedChatTabEntryWire,
): SessionTabModel {
	const base: SessionTabBaseFields = {
		agentSessionId: entry.tab.agentSessionId,
		chatTabId: entry.tab.id,
		fullLabel:
			entry.tab.fullTitle ||
			entry.tab.title ||
			entry.summaryTitle ||
			'Untitled chat',
		id: entry.tab.id,
		isPreview: false,
		isSubAgent: entry.tab.metadata.agentRole === 'subagent',
		// Prefer the short chat-title that was visible on the open tab. The
		// LLM-derived summary title is verbose and often diverges from what
		// the user saw, so it is only used when no tab title exists.
		label: entry.tab.title || entry.summaryTitle || 'Untitled chat',
		status: 'idle',
		summary: entry.summaryPath,
		updatedLabel: formatRelativeClosedAt(entry.closedAt),
	};
	// Terminal (harness) tabs keep their harness identity so the history row shows
	// the harness icon and a restore can reattach the exact conversation. The
	// backing PTY is gone once closed, so `terminalId` is cleared here: the stored
	// metadata still carries the dead id, so blank it before building the model to
	// keep "has a live PTY" (`terminalId.length > 0`) honest for history rows.
	if (entry.tab.kind === 'terminal') {
		const closedTab: ChatTabWire = {
			...entry.tab,
			metadata: { ...entry.tab.metadata, terminalId: '' },
		};
		return toTerminalSessionTab(base, closedTab);
	}
	return { ...base, kind: 'chat' };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Renders a closed-at ISO timestamp as a compact relative label
 * (`"just now"`, `"5m ago"`, `"2h ago"`, `"3d ago"`). Returns the raw input
 * when it cannot be parsed.
 */
export function formatRelativeClosedAt(closedAtIso: string): string {
	const closedAt = Date.parse(closedAtIso);
	if (Number.isNaN(closedAt)) {
		return closedAtIso;
	}
	const elapsed = Date.now() - closedAt;
	if (elapsed < MINUTE_MS) {
		return 'just now';
	}
	if (elapsed < HOUR_MS) {
		return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
	}
	if (elapsed < DAY_MS) {
		return `${Math.floor(elapsed / HOUR_MS)}h ago`;
	}
	return `${Math.floor(elapsed / DAY_MS)}d ago`;
}
