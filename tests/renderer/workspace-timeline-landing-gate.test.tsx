// @vitest-environment happy-dom

import type { QueryClient } from '@tanstack/react-query';
import { afterEach, expect, test } from 'vitest';

import { ensemblrQueryKeys } from '@/renderer/api/ensemblr/query-keys';
import { WorkspaceTimeline } from '@/renderer/components/workbench-shell/conversation-panel/workspace-timeline';
import type {
	ComposerShellState,
	SessionTabModel,
	WorkspaceLandingSummary,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { AgentSessionSnapshotWire } from '@/shared/ipc/contracts/agent-session';

import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

const WORKSPACE_ID = 'ws-landing-gate';
const LANDING_CARD = '[data-landing-card-kind]';
const EMPTY_STATE = '[data-new-chat-state="empty"]';

const LANDING_SUMMARY: WorkspaceLandingSummary = {
	branchSource: {
		baseBranch: 'master',
		branchName: 'psoldunov/route-chores-to-chat-tab',
		detail: 'Worktree branched from master.',
	},
	copiedFiles: {
		count: 2485,
		detail: 'Copied 2485 files into workspace.',
		state: 'copied',
	},
	headline: 'New workspace ready',
	kind: 'local-branch',
	repositoryName: 'ensemblr',
	setupGuidance: { detail: 'No setup script configured.', state: 'missing' },
	workspaceName: 'route-chores-to-chat-tab',
};

const composer = {
	activeAgentSessionId: null,
	workspaceCwd: '/tmp/ws-landing-gate',
} as unknown as ComposerShellState;

const activeSession = {
	agentSessionId: null,
	chatTabId: 'chat-new',
	id: 'chat-new',
} as unknown as SessionTabModel;

function createWorkspace(changedFiles: number): WorkspaceShellModel {
	return {
		changeSummary: { additions: 0, deletions: 0, files: changedFiles },
		id: WORKSPACE_ID,
		landingSummary: LANDING_SUMMARY,
		name: 'route-chores-to-chat-tab',
	} as unknown as WorkspaceShellModel;
}

function agentSession(id: string): AgentSessionSnapshotWire {
	return { id } as unknown as AgentSessionSnapshotWire;
}

function seed(
	client: QueryClient,
	sessions: readonly AgentSessionSnapshotWire[],
): void {
	client.setQueryData(
		ensemblrQueryKeys.agentSessionsForWorkspace(WORKSPACE_ID),
		{ sessions },
	);
	client.setQueryData(
		ensemblrQueryKeys.closedChatTabsWithSummary(WORKSPACE_ID),
		{ entries: [] },
	);
}

function renderTimeline(input: {
	changedFiles?: number;
	sessions?: readonly AgentSessionSnapshotWire[];
}) {
	installEnsemblrApi({
		listAgentSessions: async () => ({ sessions: input.sessions ?? [] }),
		listClosedChatTabsWithSummary: async () => ({ entries: [] }),
	});
	const client = createTestQueryClient();
	seed(client, input.sessions ?? []);
	return renderWithProviders(
		<WorkspaceTimeline
			activeSession={activeSession}
			composer={composer}
			workspace={createWorkspace(input.changedFiles ?? 0)}
		/>,
		{ client },
	).container;
}

afterEach(() => {
	clearEnsemblrApi();
});

test('an untouched workspace still greets its first chat with the landing card', () => {
	const container = renderTimeline({});

	expect(container.querySelector(LANDING_CARD)).not.toBeNull();
	expect(container.textContent).toContain('new copy of');
});

test('a sibling chat tab that already ran an agent retires the landing card', () => {
	const container = renderTimeline({ sessions: [agentSession('agent-1')] });

	expect(container.querySelector(LANDING_CARD)).toBeNull();
	expect(container.querySelector(EMPTY_STATE)).not.toBeNull();
});

test('uncommitted work retires the landing card even with no agent session', () => {
	const container = renderTimeline({ changedFiles: 18 });

	expect(container.querySelector(LANDING_CARD)).toBeNull();
	expect(container.querySelector(EMPTY_STATE)).not.toBeNull();
});

test('the landing card stays hidden until the session list has loaded', () => {
	installEnsemblrApi({
		listAgentSessions: () => new Promise(() => undefined),
		listClosedChatTabsWithSummary: async () => ({ entries: [] }),
	});
	const container = renderWithProviders(
		<WorkspaceTimeline
			activeSession={activeSession}
			composer={composer}
			workspace={createWorkspace(0)}
		/>,
	).container;

	expect(container.querySelector(LANDING_CARD)).toBeNull();
	expect(container.querySelector(EMPTY_STATE)).not.toBeNull();
});
