import { i18n } from '@/renderer/lib/i18n';
import { formatRelativeTimestamp } from '@/renderer/lib/workbench/relative-time';
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

/**
 * Label for an open tab the main process stored untitled. The row is blank by
 * design — a placeholder written there would be English forever — so the strip
 * supplies the wording, and `useSessionTabModels` re-derives it on a language
 * switch by keying its memo on the active language.
 * @returns The localized "New chat" placeholder
 */
function untitledOpenTabLabel(): string {
	return i18n.t('workbench:session-tabs.untitled', 'New chat');
}

/**
 * Label for a closed tab that never earned a title. "New chat" would misread on
 * a history row, so the history says untitled rather than new.
 * @returns The localized "Untitled chat" placeholder
 */
function untitledClosedTabLabel(): string {
	return i18n.t('workbench:session-tabs.untitled-closed', 'Untitled chat');
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
		fullLabel: tab.fullTitle || tab.title || untitledOpenTabLabel(),
		id: tab.id,
		isPreview: tab.isPreview,
		isSubAgent: tab.metadata.agentRole === 'subagent',
		label: tab.title || untitledOpenTabLabel(),
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
			untitledClosedTabLabel(),
		id: entry.tab.id,
		isPreview: false,
		isSubAgent: entry.tab.metadata.agentRole === 'subagent',
		// Prefer the short chat-title that was visible on the open tab. The
		// LLM-derived summary title is verbose and often diverges from what
		// the user saw, so it is only used when no tab title exists.
		label: entry.tab.title || entry.summaryTitle || untitledClosedTabLabel(),
		status: 'idle',
		summary: entry.summaryPath,
		updatedLabel: formatRelativeTimestamp(entry.closedAt),
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
