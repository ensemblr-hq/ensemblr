// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ConciergeLauncher } from '@/renderer/components/concierge';
import { SidebarProvider } from '@/renderer/components/ui/sidebar';
import { useAskUserQuestionSync } from '@/renderer/state/ask-user-question';
import { conciergePresentationAtom } from '@/renderer/state/concierge';
import type { AskUserQuestionBroadcast } from '@/shared/agent-control';
import type { ConciergeSessionEventWire } from '@/shared/ipc/contracts/concierge';

import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	installLocalStorage,
} from '../support/dom';

const CONCIERGE_SESSION = 'concierge-1';
const ANSWER_TEXT = 'here is what I found';

/** One assistant answer, so the panel has a transcript to settle on. */
const ANSWER: ConciergeSessionEventWire = {
	createdAt: '2026-08-24T12:00:00.000Z',
	eventType: 'message',
	id: 'evt-1',
	ordinal: 1,
	payload: {
		kind: 'message',
		payload: { kind: 'text', text: ANSWER_TEXT },
		role: 'agent',
	},
	sessionId: CONCIERGE_SESSION,
	stream: 'protocol',
};

const SESSION = {
	closedAt: null,
	createdAt: '2026-08-24T00:00:00.000Z',
	cwd: '/root/concierge',
	id: CONCIERGE_SESSION,
	lastError: null,
	model: null,
	provider: 'pi',
	runtimeOpen: true,
	status: 'idle',
	thinkingLevel: null,
	title: '',
	updatedAt: '2026-08-24T00:00:00.000Z',
};

/**
 * The questionnaire as the Concierge's own control origin announces it: keyed by
 * the Concierge session, and carrying the empty workspace id of an agent that
 * belongs to none.
 */
const CONCIERGE_ASK: AskUserQuestionBroadcast = {
	agentSessionId: CONCIERGE_SESSION,
	questions: [
		{
			options: [{ label: 'Ship it' }, { label: 'Hold' }],
			question: 'Cut the release now?',
		},
	],
	requestId: 'req-1',
	workspaceId: '',
};

const answerUserQuestion = vi.fn();
const openConciergeSession = vi.fn();
let deliverAsk: ((payload: AskUserQuestionBroadcast) => void) | null = null;

/** Mirrors the app root: the sync effect above, the Concierge launcher below. */
function Harness() {
	useAskUserQuestionSync();
	return <ConciergeLauncher />;
}

/** Opens the panel and waits for its transcript, as the user sees it. */
async function renderPanel() {
	const store = createStore();
	store.set(conciergePresentationAtom, 'panel');
	render(
		<QueryClientProvider client={createTestQueryClient()}>
			<Provider store={store}>
				<SidebarProvider defaultOpen>
					<Harness />
				</SidebarProvider>
			</Provider>
		</QueryClientProvider>,
	);
	await screen.findByText(ANSWER_TEXT);
	return store;
}

/** Pushes a questionnaire the way the main process broadcasts one. */
async function ask(payload: AskUserQuestionBroadcast = CONCIERGE_ASK) {
	await act(async () => {
		deliverAsk?.(payload);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	installLocalStorage();
	window.innerWidth = 1440;
	window.innerHeight = 960;
	deliverAsk = null;
	installEnsemblrApi({
		answerUserQuestion,
		conciergeContextPressure: vi.fn().mockResolvedValue({
			maxTokens: 200_000,
			overThreshold: false,
			percent: 4,
			thresholdPercent: 80,
			usedTokens: 8_000,
		}),
		listAgentModels: vi.fn().mockResolvedValue({
			defaultModelId: null,
			defaultThinkingLevel: null,
			models: [],
		}),
		listAgentProviderSlashCommands: vi.fn().mockResolvedValue({ commands: [] }),
		listConciergeEvents: vi.fn().mockResolvedValue({ events: [ANSWER] }),
		onAskUserQuestion: (listener: (p: AskUserQuestionBroadcast) => void) => {
			deliverAsk = listener;
			return () => {
				deliverAsk = null;
			};
		},
		onAskUserQuestionClosed: vi.fn().mockReturnValue(() => undefined),
		onConciergeSessionEvent: vi.fn().mockReturnValue(() => undefined),
		openConciergeSession,
	});
	answerUserQuestion.mockResolvedValue(undefined);
	openConciergeSession.mockResolvedValue({ session: SESSION });
});

afterEach(() => {
	vi.restoreAllMocks();
	clearEnsemblrApi();
});

describe('a question the Concierge asks', () => {
	test('renders in the panel, where the user is already looking', async () => {
		await renderPanel();

		await ask();

		expect(
			screen.getByRole('region', { name: 'Agent question' }),
		).toBeInTheDocument();
		expect(screen.getByText('Cut the release now?')).toBeInTheDocument();
	});

	test('answering it sends the answer back and takes the card down', async () => {
		await renderPanel();
		await ask();

		await act(async () => {
			screen.getByRole('button', { name: /Ship it/ }).click();
		});

		expect(answerUserQuestion).toHaveBeenCalledWith(
			expect.objectContaining({ cancelled: false, requestId: 'req-1' }),
		);
		await waitFor(() => {
			expect(screen.queryByText('Cut the release now?')).toBeNull();
		});
	});

	test('dismissing it reports a dismissal rather than an answer', async () => {
		await renderPanel();
		await ask();

		await act(async () => {
			screen.getByRole('button', { name: 'Dismiss question' }).click();
		});

		expect(answerUserQuestion).toHaveBeenCalledWith(
			expect.objectContaining({
				answers: [],
				cancelled: true,
				requestId: 'req-1',
			}),
		);
	});

	// ⎋ is the panel's own close chord, and the card is inside the panel. The
	// questionnaire claims the key first and stops it there, so dismissing a
	// question does not also shut the surface it was asked on.
	test('takes ⎋ for its own dismissal without closing the panel', async () => {
		await renderPanel();
		await ask();

		await act(async () => {
			fireEvent.keyDown(
				screen.getByRole('region', { name: 'Agent question' }),
				{
					key: 'Escape',
				},
			);
		});

		expect(answerUserQuestion).toHaveBeenCalledWith(
			expect.objectContaining({ cancelled: true, requestId: 'req-1' }),
		);
		expect(
			screen.getByRole('region', { name: 'Concierge' }),
		).toBeInTheDocument();
	});

	// The panel is a surface the user closes, not the conversation. A question
	// still waiting on them when they close it is still waiting when they come
	// back — main holds the agent open with no timeout either way.
	test('survives the panel being closed and comes back on reopen', async () => {
		const store = await renderPanel();
		await ask();

		await act(async () => {
			store.set(conciergePresentationAtom, 'closed');
		});
		expect(screen.queryByText('Cut the release now?')).toBeNull();
		expect(answerUserQuestion).not.toHaveBeenCalled();

		await act(async () => {
			store.set(conciergePresentationAtom, 'panel');
		});
		await waitFor(() => {
			expect(screen.getByText('Cut the release now?')).toBeInTheDocument();
		});
	});

	test('ignores a question raised by a workspace agent', async () => {
		await renderPanel();

		await ask({
			...CONCIERGE_ASK,
			agentSessionId: 'workspace-session',
			requestId: 'req-2',
			workspaceId: 'ws-1',
		});

		expect(screen.queryByText('Cut the release now?')).toBeNull();
	});
});
