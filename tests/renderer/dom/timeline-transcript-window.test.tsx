// @vitest-environment happy-dom

/**
 * Every message in a transcript mounts its whole markdown answer — one 17 KB
 * answer measured at 66–90 ms — and the `key` on the conversation subtree
 * remounts all of them on each chat-tab switch, so an unwindowed hundred-turn
 * transcript is a second of blocking work per open and per switch.
 *
 * The transcript therefore mounts only its newest window, and one control above
 * it reaches further back in the two senses a transcript can be short: messages
 * this window is holding back (free, so offered first), and events the persisted
 * read stopped short of (a database page, offered once the window covers
 * everything already in hand).
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '@/renderer/api/ensemblr-queries';
import { AgentSessionTimeline } from '@/renderer/components/workbench-shell/conversation-panel/timeline/timeline';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	AgentSessionEventWire,
	ListAgentSessionEventsResult,
} from '@/shared/ipc/contracts/agent-session';

import {
	createTestQueryClient,
	installEnsemblrApi,
	renderWithProviders,
} from '../support/dom';

// The turn footer's fork menu and the error-recovery hook both reach the router,
// which this tree has no reason to mount: the window under test is upstream of
// either. Stubbing the two hooks keeps the transcript itself real.
vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => vi.fn(),
	useRouter: () => ({ invalidate: vi.fn() }),
}));

const WORKSPACE_ID = 'ws-1';
const AGENT_SESSION_ID = 'agent-1';
const BRANCH_ID = 'branch-1';

/** `TRANSCRIPT_WINDOW`, restated: the timeline keeps the constant private. */
const WINDOW = 60;

const workspace = {
	id: WORKSPACE_ID,
	projectId: 'project-1',
} as unknown as WorkspaceShellModel;

const chatTab: SessionTabModel = {
	agentSessionId: AGENT_SESSION_ID,
	chatTabId: 'tab-1',
	id: 'tab-1',
	isPreview: false,
	isSubAgent: false,
	kind: 'chat',
	label: 'Long conversation',
	status: 'idle',
	summary: '',
	updatedLabel: 'Long conversation',
};

/**
 * Builds one user prompt event, which the projector turns into exactly one
 * message — so a count of events is a count of transcript rows.
 * @param ordinal - The event's position in the branch
 * @returns One wire event
 */
function promptAt(ordinal: number): AgentSessionEventWire {
	return {
		branchId: BRANCH_ID,
		createdAt: new Date(ordinal * 1000).toISOString(),
		eventType: 'message',
		id: `event-${ordinal}`,
		ordinal,
		payload: {
			kind: 'message',
			payload: { kind: 'prompt', prompt: `prompt ${ordinal}` },
			role: 'user',
		},
		stream: 'protocol',
		turnId: `turn-${ordinal}`,
	} as unknown as AgentSessionEventWire;
}

/**
 * Renders the timeline over one event window.
 *
 * The window is served from the stubbed bridge rather than only seeded into the
 * cache: the events query carries `staleTime: 0`, so it refetches on mount and a
 * seed alone is overwritten by whatever the bridge answers.
 * @param seeded - The newest window, as the persisted read returns it
 * @returns The render result and the read spy, for asserting the page cursor
 */
function renderTimeline(seeded: ListAgentSessionEventsResult) {
	const listAgentSessionEvents = vi.fn(
		async (request: { beforeOrdinal?: number }) =>
			request.beforeOrdinal === undefined ? seeded : { events: [] },
	);
	installEnsemblrApi({
		listAgentSessionEvents,
		listAgentSessions: vi.fn(() => new Promise(() => undefined)),
		onAgentSessionEvent: vi.fn(() => () => undefined),
	});
	const client = createTestQueryClient();
	client.setQueryData(
		ensemblrQueryKeys.agentSessionsForWorkspace(WORKSPACE_ID),
		{
			sessions: [
				{
					branchId: BRANCH_ID,
					id: AGENT_SESSION_ID,
					model: 'gpt-5.5',
					runtimeOpen: true,
					status: 'idle',
					updatedAt: '2026-09-12T00:00:00.000Z',
				},
			],
		},
	);
	client.setQueryData(ensemblrQueryKeys.agentSessionEvents(BRANCH_ID), seeded);
	return {
		...renderWithProviders(
			<AgentSessionTimeline
				activeAgentSessionId={AGENT_SESSION_ID}
				activeSession={chatTab}
				workspace={workspace}
			/>,
			{ client },
		),
		listAgentSessionEvents,
	};
}

/** How many transcript rows the timeline actually mounted. */
function mountedRows(container: HTMLElement): number {
	return container.querySelectorAll('[data-role="user-prompt"]').length;
}

describe('the transcript window', () => {
	test('mounts only the newest window of a long transcript', async () => {
		const { container } = renderTimeline({
			events: Array.from({ length: WINDOW + 25 }, (_, index) =>
				promptAt(index + 1),
			),
		});

		await waitFor(() => {
			expect(mountedRows(container)).toBe(WINDOW);
		});
		expect(container.textContent).toContain(`prompt ${WINDOW + 25}`);
		expect(container.textContent).not.toContain('prompt 1 ');
	});

	test('mounts a short transcript whole, with no control above it', async () => {
		const { container } = renderTimeline({
			events: Array.from({ length: 5 }, (_, index) => promptAt(index + 1)),
		});

		await waitFor(() => {
			expect(mountedRows(container)).toBe(5);
		});
		expect(screen.queryByRole('button', { name: /earlier/ })).toBeNull();
	});

	test('widens the window from the control above it', async () => {
		const { container } = renderTimeline({
			events: Array.from({ length: WINDOW + 25 }, (_, index) =>
				promptAt(index + 1),
			),
		});

		await userEvent.click(
			await screen.findByRole('button', { name: 'Show 25 earlier messages' }),
		);

		expect(mountedRows(container)).toBe(WINDOW + 25);
		expect(screen.queryByRole('button', { name: /earlier/ })).toBeNull();
	});

	test('offers the database page once the window covers what it holds', async () => {
		const { listAgentSessionEvents } = renderTimeline({
			events: [promptAt(10), promptAt(11)],
			hasOlder: true,
		});

		await userEvent.click(
			await screen.findByRole('button', { name: 'Load earlier messages' }),
		);

		expect(listAgentSessionEvents).toHaveBeenCalledWith({
			beforeOrdinal: 10,
			branchId: BRANCH_ID,
		});
	});
});
