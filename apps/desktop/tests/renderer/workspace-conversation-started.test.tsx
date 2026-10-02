// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { useWorkspaceConversationStarted } from '../../src/renderer/hooks/workspace/use-workspace-conversation-started';
import type { AgentSessionSnapshotWire } from '../../src/shared/ipc/contracts/agent-session';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const WORKSPACE_ID = 'workspace-conversation-started';

/** One persisted session, enough to mark the workspace as worked in. */
function createSession(): AgentSessionSnapshotWire {
	return {
		branchId: 'branch-1',
		closedAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		cwd: '/tmp/workspace-conversation-started',
		id: 'session-1',
		label: null,
		model: 'anthropic/claude-sonnet',
		openedTabs: [],
		provider: 'pi',
		runtimeOpen: false,
		runtimeSessionId: null,
		status: 'idle',
		thinkingLevel: 'medium',
		updatedAt: '2026-01-01T00:00:00.000Z',
		workspaceId: WORKSPACE_ID,
	};
}

/** Renders the hook against a bridge returning `sessions`. */
function renderConversationStarted(sessions: AgentSessionSnapshotWire[]) {
	return renderAgainst(async () => ({ sessions }));
}

/** Renders the hook against an arbitrary `listAgentSessions` implementation. */
function renderAgainst(
	listAgentSessions: () => Promise<{ sessions: AgentSessionSnapshotWire[] }>,
) {
	installEnsemblrApi({
		listAgentSessions: vi.fn(listAgentSessions),
	});
	const client = createTestQueryClient();
	const wrapper = ({ children }: PropsWithChildren) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	return renderHook(() => useWorkspaceConversationStarted(WORKSPACE_ID), {
		wrapper,
	});
}

afterEach(() => {
	clearEnsemblrApi();
});

// The gate has to hold the seed back until the answer is real: a false here
// would re-offer the ticket on every first paint.
test('reports null until the session list settles', () => {
	const { result } = renderConversationStarted([]);

	expect(result.current).toBeNull();
});

// null promises the caller a better answer later. A query that has exhausted its
// retries never delivers one, so reporting null there strands every caller on the
// unknown branch for the life of the cache entry.
test('reports false once the session list read has failed', async () => {
	const { result } = renderAgainst(async () => {
		throw new Error('ipc down');
	});

	await waitFor(() => {
		expect(result.current).toBe(false);
	});
});

test('reports false for a workspace with no persisted session', async () => {
	const { result } = renderConversationStarted([]);

	await waitFor(() => {
		expect(result.current).toBe(false);
	});
});

test('reports true once the workspace holds a session', async () => {
	const { result } = renderConversationStarted([createSession()]);

	await waitFor(() => {
		expect(result.current).toBe(true);
	});
});
