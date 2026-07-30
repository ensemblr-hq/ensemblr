// @vitest-environment happy-dom

/**
 * A tab spawned by `ensemblr_start_conversation` gets no optimistic prompt, and
 * Pi echoes the real one back only after its child process boots — so the
 * transcript is empty for seconds while the sub-agent is already working. These
 * tests pin the startup affordance that replaced the blank rectangle, and the
 * cases where rendering nothing is still correct.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '../../../src/renderer/api/ensemblr-queries';
import { PiSessionTimeline } from '../../../src/renderer/components/workbench-shell/conversation-panel/timeline/timeline';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '../../../src/renderer/types/workbench';
import {
	createTestQueryClient,
	installEnsemblrApi,
	renderWithProviders,
} from '../support/dom';

const WORKSPACE_ID = 'ws-1';
const PI_SESSION_ID = 'pi-1';
const BRANCH_ID = 'branch-1';

const workspace = { id: WORKSPACE_ID } as unknown as WorkspaceShellModel;

const chatTab: SessionTabModel = {
	chatTabId: 'tab-1',
	id: 'tab-1',
	isSubAgent: true,
	kind: 'chat',
	label: 'Astro inventory',
	piSessionId: PI_SESSION_ID,
	status: 'working',
	summary: '',
	updatedLabel: 'Astro inventory',
};

/**
 * Renders the timeline with the session list seeded to `sessions` and no events,
 * which is the state a freshly spawned sub-agent tab is in.
 */
function renderTimeline(options: {
	sessions?: readonly Record<string, unknown>[] | 'in-flight';
	tab?: SessionTabModel;
}) {
	const client = createTestQueryClient();
	if (options.sessions !== 'in-flight') {
		client.setQueryData(
			ensemblrQueryKeys.piSessionsForWorkspace(WORKSPACE_ID),
			{
				sessions: options.sessions ?? [],
			},
		);
	}
	client.setQueryData(ensemblrQueryKeys.piSessionEvents(BRANCH_ID), {
		events: [],
	});
	return renderWithProviders(
		<PiSessionTimeline
			activePiSessionId={null}
			activeSession={options.tab ?? chatTab}
			workspace={workspace}
		/>,
		{ client },
	);
}

/** One entry of the workspace session list, as the timeline reads it. */
function piSession(status: string) {
	return {
		branchId: BRANCH_ID,
		id: PI_SESSION_ID,
		model: 'gpt-5.5',
		runtimeOpen: true,
		status,
		updatedAt: '2026-07-30T00:00:00.000Z',
	};
}

describe('timeline startup state', () => {
	beforeEach(() => {
		installEnsemblrApi({
			listPiSessions: vi.fn(() => new Promise(() => undefined)),
			onPiSessionEvent: vi.fn(() => () => undefined),
		});
	});

	test('shows a starting affordance while a spawned session has no events yet', () => {
		const { container } = renderTimeline({ sessions: [piSession('starting')] });

		expect(
			container.querySelector('[data-timeline-state="starting"]'),
		).not.toBeNull();
		expect(container.textContent).toContain('Starting agent');
	});

	test('shows a loading affordance while the session list is still in flight', () => {
		const { container } = renderTimeline({ sessions: 'in-flight' });

		expect(
			container.querySelector('[data-timeline-state="starting"]'),
		).not.toBeNull();
		expect(container.textContent).toContain('Loading conversation');
	});

	// The loading affordance has to terminate. A session the list does not carry
	// once it has settled is gone, not arriving, and a spinner that never resolves
	// is worse than the blank panel it replaced.
	test('renders nothing once the session list settles without the binding', () => {
		const { container } = renderTimeline({ sessions: [] });

		expect(container.textContent).toBe('');
	});

	test('renders nothing for a settled session that produced no events', () => {
		const { container } = renderTimeline({ sessions: [piSession('idle')] });

		expect(container.textContent).toBe('');
	});

	test('renders nothing for a tab with no Pi session at all', () => {
		const { container } = renderTimeline({
			sessions: [],
			tab: { ...chatTab, piSessionId: null, status: 'idle' },
		});

		expect(container.textContent).toBe('');
	});
});
