// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ConciergeLauncher } from '@/renderer/components/concierge';
import { SidebarProvider } from '@/renderer/components/ui/sidebar';
import { conciergePresentationAtom } from '@/renderer/state/concierge';
import type { ConciergeSessionEventWire } from '@/shared/ipc/contracts/concierge';

import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	installLocalStorage,
} from '../support/dom';

const clearConciergeContext = vi.fn();

/** One status event, which is what the transcript reads streaming state off. */
function status(value: 'idle' | 'streaming'): ConciergeSessionEventWire {
	return {
		createdAt: '2026-08-24T12:00:00.000Z',
		eventType: 'status',
		id: `evt-${value}`,
		ordinal: 1,
		payload: { kind: 'status', previous: 'idle', status: value },
		sessionId: 'concierge-1',
		stream: 'protocol',
	} as unknown as ConciergeSessionEventWire;
}

/** Renders the Concierge open, with its transcript sitting at one status. */
function renderPanel(state: 'idle' | 'streaming') {
	installEnsemblrApi({
		clearConciergeContext,
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
		listConciergeEvents: vi.fn().mockResolvedValue({ events: [status(state)] }),
		onConciergeSessionEvent: vi.fn().mockReturnValue(() => undefined),
		openConciergeSession: vi.fn().mockResolvedValue({
			session: {
				closedAt: null,
				createdAt: '2026-08-24T00:00:00.000Z',
				cwd: '/root/concierge',
				id: 'concierge-1',
				lastError: null,
				model: null,
				provider: 'pi',
				runtimeOpen: true,
				status: state,
				thinkingLevel: null,
				title: '',
				updatedAt: '2026-08-24T00:00:00.000Z',
			},
		}),
	});
	const store = createStore();
	store.set(conciergePresentationAtom, 'panel');
	return render(
		<QueryClientProvider client={createTestQueryClient()}>
			<Provider store={store}>
				<SidebarProvider defaultOpen>
					<ConciergeLauncher />
				</SidebarProvider>
			</Provider>
		</QueryClientProvider>,
	);
}

/** The header's refresh control, which is what throws the conversation away. */
function refreshControl(): HTMLElement {
	return screen.getByRole('button', { name: /clear context/i });
}

beforeEach(() => {
	installLocalStorage();
	clearConciergeContext.mockReset();
	clearConciergeContext.mockResolvedValue({ memoryPassStarted: false });
});

afterEach(() => {
	clearEnsemblrApi();
	vi.restoreAllMocks();
});

describe('clearing the Concierge context mid-turn', () => {
	// The control sits one click from maximize and one chord from ⌘⇧M, and a
	// clear replaces the conversation — pressed mid-answer it throws away work
	// the user is watching arrive.
	test('asks before throwing away a streaming turn', async () => {
		renderPanel('streaming');
		await waitFor(() => expect(refreshControl()).toBeEnabled());

		await userEvent.click(refreshControl());

		expect(
			await screen.findByRole('heading', { name: /clear context while/i }),
		).toBeVisible();
		expect(clearConciergeContext).not.toHaveBeenCalled();
	});

	test('clears once the user confirms', async () => {
		renderPanel('streaming');
		await waitFor(() => expect(refreshControl()).toBeEnabled());
		await userEvent.click(refreshControl());
		await screen.findByRole('heading', { name: /clear context while/i });

		await userEvent.click(
			screen.getByRole('button', { name: /clear anyway/i }),
		);

		await waitFor(() => {
			expect(clearConciergeContext).toHaveBeenCalledWith({ reason: 'manual' });
		});
	});

	test('keeps the turn when the user backs out', async () => {
		renderPanel('streaming');
		await waitFor(() => expect(refreshControl()).toBeEnabled());
		await userEvent.click(refreshControl());
		await screen.findByRole('heading', { name: /clear context while/i });

		await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

		await waitFor(() => {
			expect(
				screen.queryByRole('heading', { name: /clear context while/i }),
			).toBeNull();
		});
		expect(clearConciergeContext).not.toHaveBeenCalled();
	});

	// Nothing is in flight to lose, so the question would be pure friction on the
	// control's ordinary use.
	test('clears an idle conversation without asking', async () => {
		renderPanel('idle');
		await waitFor(() => expect(refreshControl()).toBeEnabled());

		await userEvent.click(refreshControl());

		await waitFor(() => {
			expect(clearConciergeContext).toHaveBeenCalledWith({ reason: 'manual' });
		});
		expect(
			screen.queryByRole('heading', { name: /clear context while/i }),
		).toBeNull();
	});
});
