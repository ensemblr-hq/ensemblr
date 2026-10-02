// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test } from 'vitest';

import { useWorkspaceAgentRoleResolver } from '../../src/renderer/state/workspace/agent-role-resolver';
import type { ChatTabWire } from '../../src/shared/ipc/contracts/chat-tab';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const WORKSPACE_ID = 'ws-1';

const tab = (
	overrides: Partial<ChatTabWire> & Pick<ChatTabWire, 'id'>,
): ChatTabWire => ({
	agentSessionId: null,
	closedAt: null,
	fullTitle: overrides.title ?? 'Chat',
	isPreview: false,
	kind: 'chat',
	metadata: {},
	openedAt: '2026-09-01T00:00:00.000Z',
	position: 0,
	title: 'Chat',
	workspaceId: WORKSPACE_ID,
	...overrides,
});

const subAgentTab = (id: string, agentSessionId: string): ChatTabWire =>
	tab({ agentSessionId, id, metadata: { agentRole: 'subagent' } });

const listing = (open: ChatTabWire[], closed: ChatTabWire[] = []) => {
	installEnsemblrApi({
		listChatTabs: async () => ({ closed, open }),
	});
};

const renderResolver = () => {
	const client = createTestQueryClient();
	return renderHook(() => useWorkspaceAgentRoleResolver(WORKSPACE_ID), {
		wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		),
	});
};

afterEach(() => {
	clearEnsemblrApi();
});

// Null while the listing is in flight is what keeps the sub-agent wording on
// first paint rather than flashing the neutral fallback and settling after.
test('answers nothing until the workspace listing has loaded', async () => {
	listing([subAgentTab('tab-1', 'session-child')]);
	const { result } = renderResolver();

	expect(result.current).toBeNull();

	await waitFor(() => expect(result.current).not.toBeNull());
	expect(result.current?.('session-child')).toBe('subagent');
});

test('reads a tab carrying no marker as a root orchestrator', async () => {
	listing([tab({ agentSessionId: 'session-review', id: 'tab-review' })]);
	const { result } = renderResolver();

	await waitFor(() => expect(result.current).not.toBeNull());
	expect(result.current?.('session-review')).toBe('orchestrator');
});

// An orchestrator closes a delegate's tab once it has collected the report, and
// the row that steered it stays in the transcript long after.
test('still places a finished delegate whose tab has been closed', async () => {
	listing(
		[],
		[
			{
				...subAgentTab('tab-done', 'session-done'),
				closedAt: '2026-09-02T00:00:00.000Z',
			},
		],
	);
	const { result } = renderResolver();

	await waitFor(() => expect(result.current).not.toBeNull());
	expect(result.current?.('session-done')).toBe('subagent');
});

// `bindAgentSession` clears a session's pointer only off open rows, so an
// archived tab keeps pointing at a session another tab now hosts. Main breaks
// that tie open-first (`getChatTabByAgentSessionId` orders
// `closed_at IS NULL DESC`) and the resolver has to land on the same answer.
test('lets the open tab win when an archived one names the same session', async () => {
	listing(
		[tab({ agentSessionId: 'session-moved', id: 'tab-live' })],
		[
			{
				...subAgentTab('tab-archived', 'session-moved'),
				closedAt: '2026-09-02T00:00:00.000Z',
			},
		],
	);
	const { result } = renderResolver();

	await waitFor(() => expect(result.current).not.toBeNull());
	expect(result.current?.('session-moved')).toBe('orchestrator');
});

test('answers null for a session the workspace never held', async () => {
	listing([subAgentTab('tab-1', 'session-child')]);
	const { result } = renderResolver();

	await waitFor(() => expect(result.current).not.toBeNull());
	expect(result.current?.('session-elsewhere')).toBeNull();
});
