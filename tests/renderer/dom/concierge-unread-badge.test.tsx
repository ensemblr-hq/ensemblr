// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ConciergeLauncher } from '@/renderer/components/concierge';
import { SidebarProvider } from '@/renderer/components/ui/sidebar';
import { useConciergeActivityWatch } from '@/renderer/hooks/concierge/use-concierge-activity-watch';
import { pendingAskUserQuestionsAtom } from '@/renderer/state/ask-user-question';
import { conciergePresentationAtom } from '@/renderer/state/concierge';
import type { ConciergeEventBroadcastWire } from '@/shared/ipc/contracts/concierge';

import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	installLocalStorage,
} from '../support/dom';

/** Every listener the bridge stub has handed out, so a test can push events. */
let listeners: ((broadcast: ConciergeEventBroadcastWire) => void)[] = [];

const SESSION_ID = 'concierge-1';

/**
 * Mounts the launcher under the app-root watcher, which is where the badge's
 * count actually comes from — the launcher itself only renders it.
 */
function Harness() {
	useConciergeActivityWatch();
	return <ConciergeLauncher />;
}

function renderHarness(store = createStore()) {
	render(
		<QueryClientProvider client={createTestQueryClient()}>
			<Provider store={store}>
				<SidebarProvider defaultOpen={true}>
					<Harness />
				</SidebarProvider>
			</Provider>
		</QueryClientProvider>,
	);
	return store;
}

function broadcast(payload: unknown, id: string, live = true): void {
	act(() => {
		for (const listener of listeners) {
			listener({
				event: {
					createdAt: '2026-08-24T00:00:01.000Z',
					eventType: 'message',
					id,
					ordinal: 1,
					payload: payload as never,
					sessionId: SESSION_ID,
					stream: 'protocol',
				},
				live,
				sessionId: SESSION_ID,
			});
		}
	});
}

function sendAgentMessage(text: string, id: string): void {
	broadcast(
		{
			kind: 'message',
			payload: {
				kind: 'message',
				parts: [{ kind: 'text', text }],
				role: 'assistant',
			},
			role: 'agent',
		},
		id,
	);
}

function sendStatus(status: string, id: string): void {
	broadcast({ kind: 'status', previous: 'idle', status }, id);
}

/** The stream a child a context clear retired keeps emitting while it writes. */
function sendRetired(payload: unknown, id: string): void {
	broadcast(payload, id, false);
}

function badge(): HTMLElement | null {
	return document.querySelector('[data-concierge-unread-count]');
}

beforeEach(() => {
	installLocalStorage();
	listeners = [];
	installEnsemblrApi({
		conciergeContextPressure: vi.fn().mockResolvedValue({
			maxTokens: 200_000,
			overThreshold: false,
			percent: 5,
			thresholdPercent: 80,
			usedTokens: 10_000,
		}),
		listAgentModels: vi.fn().mockResolvedValue({
			defaultModelId: null,
			defaultThinkingLevel: null,
			models: [],
		}),
		listAgentProviderSlashCommands: vi.fn().mockResolvedValue({ commands: [] }),
		listConciergeEvents: vi.fn().mockResolvedValue({ events: [] }),
		onConciergeSessionEvent: (
			listener: (broadcast: ConciergeEventBroadcastWire) => void,
		) => {
			listeners.push(listener);
			return () => {
				listeners = listeners.filter((held) => held !== listener);
			};
		},
		openConciergeSession: vi.fn().mockResolvedValue({
			session: {
				closedAt: null,
				createdAt: '2026-08-24T00:00:00.000Z',
				cwd: '/root/concierge',
				id: SESSION_ID,
				lastError: null,
				model: null,
				provider: 'pi',
				runtimeOpen: true,
				status: 'idle',
				thinkingLevel: null,
				title: '',
				updatedAt: '2026-08-24T00:00:00.000Z',
			},
		}),
		reportConciergeVisibility: vi.fn().mockResolvedValue(undefined),
	});
});

afterEach(() => {
	clearEnsemblrApi();
});

describe('the Concierge launcher badge', () => {
	test('counts agent messages that land while the panel is shut', () => {
		renderHarness();

		expect(badge()).toBeNull();

		sendAgentMessage('Read the board.', 'evt-1');
		expect(badge()).toHaveTextContent('1');

		sendAgentMessage('Two workspaces are stale.', 'evt-2');
		expect(badge()).toHaveTextContent('2');
	});

	test('counts nothing while the panel is open', () => {
		const store = createStore();
		store.set(conciergePresentationAtom, 'panel');
		renderHarness(store);

		sendAgentMessage('Read the board.', 'evt-1');

		store.set(conciergePresentationAtom, 'closed');
		expect(badge()).toBeNull();
	});

	test('opening the panel marks everything read', async () => {
		renderHarness();
		sendAgentMessage('Read the board.', 'evt-1');
		expect(badge()).toHaveTextContent('1');

		await userEvent.click(screen.getByRole('button', { name: /Concierge/ }));

		expect(badge()).toBeNull();
	});

	test('collapses a runaway count rather than growing past the bubble', () => {
		renderHarness();
		for (let index = 0; index < 11; index += 1) {
			sendAgentMessage(`Message ${index}`, `evt-${index}`);
		}
		expect(badge()).toHaveTextContent('9+');
	});

	test('carries the count in the button’s own label', () => {
		renderHarness();
		sendAgentMessage('Read the board.', 'evt-1');

		expect(
			screen.getByRole('button', {
				name: 'Open the Concierge, 1 new message',
			}),
		).toBeInTheDocument();
	});

	test('a blocked questionnaire counts, and says so once answered', () => {
		const store = createStore();
		renderHarness(store);

		act(() => {
			store.set(pendingAskUserQuestionsAtom, {
				[SESSION_ID]: {
					agentSessionId: SESSION_ID,
					questions: [],
					requestId: 'ask-1',
					workspaceId: '',
				} as never,
			});
		});
		expect(badge()).toHaveTextContent('1');

		act(() => {
			store.set(pendingAskUserQuestionsAtom, {});
		});
		expect(badge()).toBeNull();
	});

	// A context clear retires the running child and leaves it to write its
	// memories, which is a whole turn on the same stream. Counted here it would
	// report unread prose from a conversation the panel can no longer open.
	test('ignores the turn a retired child runs after a context clear', () => {
		renderHarness();

		sendRetired(
			{
				kind: 'message',
				payload: {
					kind: 'message',
					parts: [{ kind: 'text', text: 'Wrote the notes.' }],
					role: 'assistant',
				},
				role: 'agent',
			},
			'evt-retired-1',
		);
		sendRetired(
			{ kind: 'status', previous: 'idle', status: 'streaming' },
			'evt-retired-2',
		);

		expect(badge()).toBeNull();
		expect(orbitRing()?.getAttribute('class')).not.toContain(
			'motion-safe:animate-concierge-orbit',
		);
	});

	// A child that dies mid-turn emits `shutdown` and no trailing `idle`, so
	// without handling it the bubble orbited for a turn nothing was running.
	test('stops orbiting when the runtime shuts down mid-turn', () => {
		renderHarness();
		sendStatus('streaming', 'evt-status-1');
		expect(orbitRing()?.getAttribute('class')).toContain(
			'motion-safe:animate-concierge-orbit',
		);

		broadcast({ kind: 'shutdown', reason: 'crashed' }, 'evt-shutdown-1');

		expect(orbitRing()?.getAttribute('class')).not.toContain(
			'motion-safe:animate-concierge-orbit',
		);
	});

	test('orbits the mark while a turn streams, and stops when it ends', () => {
		renderHarness();

		expect(orbitRing()?.getAttribute('class')).not.toContain(
			'motion-safe:animate-concierge-orbit',
		);

		sendStatus('streaming', 'evt-status-1');
		expect(orbitRing()?.getAttribute('class')).toContain(
			'motion-safe:animate-concierge-orbit',
		);

		sendStatus('idle', 'evt-status-2');
		expect(orbitRing()?.getAttribute('class')).not.toContain(
			'motion-safe:animate-concierge-orbit',
		);
	});
});

/** The mark's orbiting group, which is the element the working state animates. */
function orbitRing(): Element | null {
	return document.querySelector('button svg g');
}
