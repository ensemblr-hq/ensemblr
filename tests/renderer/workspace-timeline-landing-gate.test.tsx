// @vitest-environment happy-dom

import type { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
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
import type { ChatTabSummaryEntryWire } from '@/shared/ipc/contracts/chat-tab';

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

/** An open chat's summary entry, as the main process now reports one. */
function openChatEntry(id: string, title: string): ChatTabSummaryEntryWire {
	return {
		closedAt: null,
		summaryPath: `${composer.workspaceCwd}/.context/sessions/${id}.md`,
		summaryTitle: null,
		summaryUpdatedAt: '2026-09-03T00:00:00.000Z',
		tab: {
			agentSessionId: null,
			closedAt: null,
			fullTitle: title,
			id,
			isPreview: false,
			kind: 'chat',
			metadata: {},
			openedAt: '2026-09-03T00:00:00.000Z',
			position: 0,
			title,
			workspaceId: WORKSPACE_ID,
		},
	};
}

function seed(
	client: QueryClient,
	sessions: readonly AgentSessionSnapshotWire[],
	entries: readonly ChatTabSummaryEntryWire[],
): void {
	client.setQueryData(
		ensemblrQueryKeys.agentSessionsForWorkspace(WORKSPACE_ID),
		{ sessions },
	);
	client.setQueryData(ensemblrQueryKeys.chatTabSummaries(WORKSPACE_ID), {
		entries,
	});
}

function renderTimeline(input: {
	changedFiles?: number;
	changedPaths?: readonly string[];
	entries?: readonly ChatTabSummaryEntryWire[];
	sessions?: readonly AgentSessionSnapshotWire[];
}) {
	const entries = input.entries ?? [];
	const changedPaths = input.changedPaths ?? [];
	installEnsemblrApi({
		getWorkspaceGitStatus: async () => ({
			files: changedPaths.map((path) => ({
				additions: 1,
				deletions: 0,
				path,
				status: 'modified',
			})),
			summary: {
				additions: changedPaths.length,
				deletions: 0,
				files: changedPaths.length,
			},
		}),
		listAgentSessions: async () => ({ sessions: input.sessions ?? [] }),
		listChatTabSummaries: async () => ({ entries }),
	});
	const client = createTestQueryClient();
	seed(client, input.sessions ?? [], entries);
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

// The app writes into a workspace it has just cut — the seed architecture scan
// lands in `.ensemblr/` — so those files are not a sign anyone has worked here.
test('a worktree only the app dirtied keeps the landing card', async () => {
	const container = renderTimeline({
		changedFiles: 2,
		changedPaths: ['.ensemblr/architecture.json', '.context/plans/first.md'],
	});

	await waitFor(() => {
		expect(container.querySelector(LANDING_CARD)).not.toBeNull();
	});
	expect(container.textContent).toContain('new copy of');
});

// What the gate is for: a user who never opened a chat, worked in a terminal,
// and edited forty files must not be greeted with "New workspace ready".
test('a worktree the user dirtied retires the landing card', async () => {
	const container = renderTimeline({
		changedFiles: 3,
		changedPaths: [
			'.ensemblr/architecture.json',
			'src/main/storage/database.ts',
			'docs/architecture-map.md',
		],
	});

	await waitFor(() => {
		expect(container.querySelector(LANDING_CARD)).toBeNull();
	});
	expect(container.querySelector(EMPTY_STATE)).not.toBeNull();
});

test('the landing card stays hidden until the session list has loaded', () => {
	installEnsemblrApi({
		listAgentSessions: () => new Promise(() => undefined),
		listChatTabSummaries: async () => ({ entries: [] }),
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

test('a sibling chat still open is offered as a chip', () => {
	// What the surface was reported broken for: the chips only ever listed closed
	// tabs, so a workspace whose chats were all open showed an empty row.
	const container = renderTimeline({
		entries: [openChatEntry('chat-sibling', 'Retire reclaim disk')],
	});

	expect(container.querySelector(LANDING_CARD)).toBeNull();
	expect(
		container.querySelector('[data-transcript-id="chat-sibling"]'),
	).not.toBeNull();
});

test('the chat being typed in is not offered as a chip against itself', () => {
	const container = renderTimeline({
		entries: [
			openChatEntry(activeSession.chatTabId, 'This chat'),
			openChatEntry('chat-sibling', 'Retire reclaim disk'),
		],
	});

	expect(
		container.querySelector(
			`[data-transcript-id="${activeSession.chatTabId}"]`,
		),
	).toBeNull();
	expect(
		container.querySelector('[data-transcript-id="chat-sibling"]'),
	).not.toBeNull();
});
