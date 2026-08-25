// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ConciergeLauncher } from '@/renderer/components/concierge';
import { SidebarProvider } from '@/renderer/components/ui/sidebar';
import {
	conciergePresentationAtom,
	conciergePreviewAtom,
} from '@/renderer/state/concierge';

import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	installLocalStorage,
} from '../support/dom';

const HOME = '/root/concierge';

/** Renders the Concierge open, with an artifact already up in its viewer. */
function renderPanelOverPreview(store: ReturnType<typeof createStore>) {
	store.set(conciergePresentationAtom, 'panel');
	store.set(conciergePreviewAtom, {
		path: 'artifacts/release-plan.md',
		title: 'release-plan.md',
	});
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

beforeEach(() => {
	installLocalStorage();
	installEnsemblrApi({
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
		listConciergeEvents: vi.fn().mockResolvedValue({ events: [] }),
		onConciergeSessionEvent: vi.fn().mockReturnValue(() => undefined),
		openConciergeSession: vi.fn().mockResolvedValue({
			session: {
				closedAt: null,
				createdAt: '2026-08-24T00:00:00.000Z',
				cwd: HOME,
				id: 'concierge-1',
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
		readWorkspaceFile: vi.fn().mockResolvedValue({
			content: '# Release plan',
			path: 'artifacts/release-plan.md',
			sizeBytes: 14,
			truncated: false,
		}),
	});
});

afterEach(() => {
	clearEnsemblrApi();
});

// The viewer covers the transcript but not the header, so the header's controls
// keep meaning what they say while a file is up.
describe('closing the Concierge over an open preview', () => {
	test('the header’s close button closes the panel, not just the preview', async () => {
		const store = createStore();
		renderPanelOverPreview(store);
		await screen.findByRole('button', { name: /^close$/i });

		await userEvent.click(screen.getByRole('button', { name: /^close$/i }));

		await waitFor(() => {
			expect(store.get(conciergePresentationAtom)).toBe('closed');
		});
		// Left behind, it would be covering the transcript the next time the panel
		// opened, on a file the user closed the app over.
		expect(store.get(conciergePreviewAtom)).toBeNull();
	});

	test('the preview’s own control returns to the conversation', async () => {
		const store = createStore();
		renderPanelOverPreview(store);

		await userEvent.click(
			await screen.findByRole('button', { name: /back to the conversation/i }),
		);

		await waitFor(() => {
			expect(store.get(conciergePreviewAtom)).toBeNull();
		});
		expect(store.get(conciergePresentationAtom)).toBe('panel');
	});
});
