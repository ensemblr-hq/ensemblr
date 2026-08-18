// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { useLinkedIssueComposerSeed } from '../../src/renderer/hooks/workspace/use-linked-issue-composer-seed';
import type { WorkspaceLinkedIssueSummary } from '../../src/renderer/types/workbench';
import type { AgentSessionSnapshotWire } from '../../src/shared/ipc/contracts/agent-session';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const WORKSPACE_ID = 'workspace-linked-issue-seed';

const linkedIssue: WorkspaceLinkedIssueSummary = {
	description: 'Publish tagged releases.',
	provider: 'linear',
	reference: 'THE-194',
	remoteId: 'issue-194',
	title: 'Automate releases',
	url: 'https://linear.app/acme/issue/THE-194',
};

/** One persisted session, enough to mark the workspace as worked in. */
function createSession(): AgentSessionSnapshotWire {
	return {
		branchId: 'branch-1',
		closedAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		cwd: '/tmp/workspace-linked-issue-seed',
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

/** Mounts the seed hook against a bridge that reports `sessions` for the workspace. */
function renderSeed({
	agentSessionId = null,
	issue = linkedIssue,
	listAgentSessions,
}: {
	agentSessionId?: string | null;
	issue?: WorkspaceLinkedIssueSummary | undefined;
	listAgentSessions: () => Promise<{
		sessions: AgentSessionSnapshotWire[];
	}>;
}) {
	installEnsemblrApi({ listAgentSessions: vi.fn(listAgentSessions) });
	const client = createTestQueryClient();
	const wrapper = ({ children }: PropsWithChildren) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	return renderHook(
		() =>
			useLinkedIssueComposerSeed({
				agentSessionId,
				linkedIssue: issue,
				workspaceId: WORKSPACE_ID,
			}),
		{ wrapper },
	);
}

/** A bridge that always answers with `sessions`. */
function serving(sessions: AgentSessionSnapshotWire[]) {
	return async () => ({ sessions });
}

afterEach(() => {
	clearEnsemblrApi();
});

test('seeds the opening chat of a workspace nothing has run in yet', async () => {
	const { result } = renderSeed({ listAgentSessions: serving([]) });

	await waitFor(() => {
		expect(result.current).toBe(linkedIssue);
	});
});

// The reported bug: every chat opened after the first re-offered the ticket,
// because "this tab has no session" is true of every fresh tab forever. The gate
// has to be workspace-wide, so this asserts against the hook the composer calls
// rather than the resolver underneath it.
test('seeds no further chat once the workspace has a conversation', async () => {
	const { result } = renderSeed({
		listAgentSessions: serving([createSession()]),
	});

	await waitFor(() => {
		expect(result.current).toBeUndefined();
	});
	expect(result.current).toBeUndefined();
});

// A false here would re-offer the ticket on every first paint, before the list
// that decides the question has said anything.
test('seeds nothing while the workspace session list is still loading', () => {
	const { result } = renderSeed({
		listAgentSessions: () => new Promise(() => {}),
	});

	expect(result.current).toBeUndefined();
});

// A failed read is settled, not unknown: it never resolves later, so holding the
// seed back on it would lose the ticket for good.
test('seeds the opening chat when the session list read fails', async () => {
	const { result } = renderSeed({
		listAgentSessions: async () => {
			throw new Error('ipc down');
		},
	});

	await waitFor(() => {
		expect(result.current).toBe(linkedIssue);
	});
});

// The tab list can report a bound session before the workspace session list
// refetches, so the per-tab check still stands on its own.
test('seeds no chat that already owns an agent session', async () => {
	const { result } = renderSeed({
		agentSessionId: 'session-1',
		listAgentSessions: serving([]),
	});

	await waitFor(() => {
		expect(result.current).toBeUndefined();
	});
	expect(result.current).toBeUndefined();
});

test('seeds nothing for a workspace created from no issue', async () => {
	const { result } = renderSeed({
		issue: undefined,
		listAgentSessions: serving([]),
	});

	await waitFor(() => {
		expect(result.current).toBeUndefined();
	});
});
