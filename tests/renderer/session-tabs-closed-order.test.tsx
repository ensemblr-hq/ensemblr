// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, expect, test } from 'vitest';

import { ensemblrQueryKeys } from '@/renderer/api/ensemblr-queries';
import { getDefaultWorkspace } from '@/renderer/fixtures/workbench';
import { useSessionTabModels } from '@/renderer/state/workspace/session-tab-models';
import type { SessionTabModel } from '@/renderer/types/workbench';
import type { AgentSessionSnapshotWire } from '@/shared/ipc/contracts/agent-session';
import type {
	ChatTabSummaryEntryWire,
	ChatTabWire,
} from '@/shared/ipc/contracts/chat-tab';

import { createTestQueryClient, installLocalStorage } from './support/dom';

const WORKSPACE_ID = 'workspace-history';

/**
 * Builds a closed tab's summary entry. A terminal tab never has a transcript
 * written for it, so main reports it with no summary path and no mtime.
 */
function closedEntry({
	closedAt,
	id,
	kind,
	summaryUpdatedAt,
}: {
	closedAt: string;
	id: string;
	kind: 'chat' | 'terminal';
	summaryUpdatedAt: string | null;
}): ChatTabSummaryEntryWire {
	return {
		closedAt,
		summaryPath: summaryUpdatedAt ? `/tmp/ws/.context/sessions/${id}.md` : '',
		summaryTitle: null,
		summaryUpdatedAt,
		tab: {
			agentSessionId: `session-${id}`,
			closedAt,
			fullTitle: id,
			id,
			isPreview: false,
			kind,
			metadata: kind === 'terminal' ? { harnessId: 'claude' } : {},
			openedAt: closedAt,
			position: 0,
			title: id,
			workspaceId: WORKSPACE_ID,
		},
	};
}

// A chat worked in months ago, and a Claude Code terminal closed just now. Main
// hands these over ranked by transcript freshness with the transcript-less one
// last, which is the order the attach chips want.
const OLD_CHAT = closedEntry({
	closedAt: '2026-03-01T00:00:00.000Z',
	id: 'old-chat',
	kind: 'chat',
	summaryUpdatedAt: '2026-03-01T00:00:00.000Z',
});
const FRESH_TERMINAL = closedEntry({
	closedAt: '2026-09-03T12:00:00.000Z',
	id: 'fresh-terminal',
	kind: 'terminal',
	summaryUpdatedAt: null,
});

/** Builds one open chat row attached to an agent session. */
function openChat(id: string, agentSessionId: string): ChatTabWire {
	return {
		agentSessionId,
		closedAt: null,
		fullTitle: id,
		id,
		isPreview: false,
		kind: 'chat',
		metadata: {},
		openedAt: '2026-01-01T00:00:00.000Z',
		position: 0,
		title: id,
		workspaceId: WORKSPACE_ID,
	};
}

/** Builds one session snapshot with durable parent lineage. */
function agentSnapshot(
	id: string,
	parentSessionId: string | null,
): AgentSessionSnapshotWire {
	return {
		branchId: `branch-${id}`,
		closedAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		cwd: '/tmp/workspace-history',
		id,
		label: null,
		lineage: {
			depth: parentSessionId ? 1 : 0,
			parentSessionId,
			rootSessionId: parentSessionId ?? id,
		},
		model: null,
		openedTabs: [],
		provider: 'pi',
		runtimeOpen: true,
		runtimeSessionId: `runtime-${id}`,
		status: 'idle',
		thinkingLevel: null,
		updatedAt: '2026-01-01T00:00:00.000Z',
		workspaceId: WORKSPACE_ID,
	};
}

/** Builds the routed session the workspace route derives from the `$chatId` param. */
function routedSession(id: string): SessionTabModel {
	return {
		agentSessionId: null,
		chatTabId: id,
		fullLabel: id,
		id,
		isPreview: false,
		isSubAgent: false,
		kind: 'chat',
		label: id,
		status: 'idle',
		summary: '',
		updatedLabel: '',
	};
}

/** Drives the hook the history dropdown reads its closed-tab rows from. */
function renderClosedSessions(
	client: ReturnType<typeof createTestQueryClient>,
) {
	return renderHook(
		() =>
			useSessionTabModels({
				activeSession: routedSession('tab-1'),
				activeWorkspace: { ...getDefaultWorkspace(), id: WORKSPACE_ID },
				busyTerminalIds: new Set<string>(),
				terminalTitles: {},
			}),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={client}>
					<Provider store={createStore()}>{children}</Provider>
				</QueryClientProvider>
			),
		},
	);
}

let client: ReturnType<typeof createTestQueryClient>;

beforeEach(() => {
	installLocalStorage();
	client = createTestQueryClient();
	client.setQueryData(ensemblrQueryKeys.chatTabs(WORKSPACE_ID), {
		closed: [],
		open: [],
	});
	client.setQueryData(
		ensemblrQueryKeys.agentSessionsForWorkspace(WORKSPACE_ID),
		{ sessions: [] },
	);
});

test('the history dropdown ranks closed tabs by close time, not transcript age', () => {
	client.setQueryData(ensemblrQueryKeys.chatTabSummaries(WORKSPACE_ID), {
		entries: [OLD_CHAT, FRESH_TERMINAL],
	});

	const { result } = renderClosedSessions(client);

	// The regression this guards: main sinks transcript-less entries to the end
	// for the attach chips, and a terminal tab never has a transcript — so
	// inheriting that order files the terminal closed minutes ago below a chat
	// closed six months earlier.
	expect(result.current.closedSessions.map((session) => session.id)).toEqual([
		'fresh-terminal',
		'old-chat',
	]);
});

test('session hierarchy prefers an open holder over an archived duplicate', () => {
	const archived = closedEntry({
		closedAt: '2026-09-03T00:00:00.000Z',
		id: 'archived-root',
		kind: 'chat',
		summaryUpdatedAt: '2026-09-03T00:00:00.000Z',
	});
	const archivedRoot = {
		...archived,
		tab: { ...archived.tab, agentSessionId: 'root-session' },
	};
	client.setQueryData(ensemblrQueryKeys.chatTabs(WORKSPACE_ID), {
		closed: [archivedRoot.tab],
		open: [
			openChat('open-root', 'root-session'),
			openChat('open-child', 'child-session'),
		],
	});
	client.setQueryData(ensemblrQueryKeys.chatTabSummaries(WORKSPACE_ID), {
		entries: [archivedRoot],
	});
	client.setQueryData(
		ensemblrQueryKeys.agentSessionsForWorkspace(WORKSPACE_ID),
		{
			sessions: [
				agentSnapshot('root-session', null),
				agentSnapshot('child-session', 'root-session'),
			],
		},
	);

	const { result } = renderClosedSessions(client);

	expect(
		result.current.sessionTabs.find((tab) => tab.id === 'open-child')
			?.parentChatTabId,
	).toBe('open-root');
});

test('session hierarchy uses the newest archive when no open holder exists', () => {
	const older = closedEntry({
		closedAt: '2026-09-02T00:00:00.000Z',
		id: 'older-root',
		kind: 'chat',
		summaryUpdatedAt: '2026-09-02T00:00:00.000Z',
	});
	const newer = closedEntry({
		closedAt: '2026-09-03T00:00:00.000Z',
		id: 'newer-root',
		kind: 'chat',
		summaryUpdatedAt: '2026-09-03T00:00:00.000Z',
	});
	const rootArchives = [older, newer].map((entry) => ({
		...entry,
		tab: { ...entry.tab, agentSessionId: 'root-session' },
	}));
	client.setQueryData(ensemblrQueryKeys.chatTabs(WORKSPACE_ID), {
		closed: rootArchives.map((entry) => entry.tab),
		open: [openChat('open-child', 'child-session')],
	});
	client.setQueryData(ensemblrQueryKeys.chatTabSummaries(WORKSPACE_ID), {
		entries: rootArchives,
	});
	client.setQueryData(
		ensemblrQueryKeys.agentSessionsForWorkspace(WORKSPACE_ID),
		{
			sessions: [
				agentSnapshot('root-session', null),
				agentSnapshot('child-session', 'root-session'),
			],
		},
	);

	const { result } = renderClosedSessions(client);

	expect(
		result.current.sessionTabs.find((tab) => tab.id === 'open-child')
			?.parentChatTabId,
	).toBe('newer-root');
});

test('the history dropdown drops the open tabs the attach chips are listed for', () => {
	const openChat: ChatTabSummaryEntryWire = {
		...OLD_CHAT,
		closedAt: null,
		tab: { ...OLD_CHAT.tab, closedAt: null, id: 'live-chat' },
	};
	client.setQueryData(ensemblrQueryKeys.chatTabSummaries(WORKSPACE_ID), {
		entries: [openChat, FRESH_TERMINAL],
	});

	const { result } = renderClosedSessions(client);

	expect(result.current.closedSessions.map((session) => session.id)).toEqual([
		'fresh-terminal',
	]);
});
