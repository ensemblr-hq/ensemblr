// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ConciergeLauncher } from '@/renderer/components/concierge';
import { SidebarProvider } from '@/renderer/components/ui/sidebar';
import {
	CONCIERGE_MIN_PANEL_SIZE,
	conciergeAnchorAtom,
	conciergePanelSizeAtom,
	conciergePresentationAtom,
} from '@/renderer/state/concierge';

import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	installLocalStorage,
} from '../support/dom';

/** Where the fake panel sits, well clear of every viewport margin. */
const PANEL_RECT = { height: 512, left: 400, top: 200, width: 416 };

/**
 * Renders the Concierge with its panel already open, on a store the test owns
 * so the size and anchor atoms can be read back.
 * @param store - Jotai store seeded with the open presentation.
 */
function renderOpenPanel(store: ReturnType<typeof createStore>) {
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

/**
 * Teaches happy-dom the panel's geometry, which it otherwise reports as zeros —
 * the resize gesture measures the node it is about to move, so without this
 * every drag would open on an empty rectangle.
 * @param node - The panel element.
 * @param rect - The rectangle to report.
 */
function stubRect(
	node: Element,
	rect: { height: number; left: number; top: number; width: number },
): void {
	vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
		bottom: rect.top + rect.height,
		height: rect.height,
		left: rect.left,
		right: rect.left + rect.width,
		toJSON: () => ({}),
		top: rect.top,
		width: rect.width,
		x: rect.left,
		y: rect.top,
	} as DOMRect);
}

/** Drives one complete pointer drag on a grip, in the order the hook listens. */
function dragGrip(grip: Element, dx: number, dy: number): void {
	grip.dispatchEvent(
		new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }),
	);
	window.dispatchEvent(
		new PointerEvent('pointermove', { clientX: dx, clientY: dy }),
	);
	window.dispatchEvent(
		new PointerEvent('pointerup', { clientX: dx, clientY: dy }),
	);
}

/**
 * Reads back the grip for one edge. They carry no accessible name apart from
 * the keyboard one, so the cursor class is what names each of them here — which
 * is also the pairing a wrong cursor would break.
 * @param panel - The Concierge panel element.
 * @param cursor - The resize cursor the wanted grip carries.
 * @param position - A positioning class unique to that grip.
 * @returns The matching grip element.
 */
function grip(panel: Element, cursor: string, position: string): Element {
	const found = [...panel.querySelectorAll('button')].find(
		(candidate) =>
			candidate.className.includes(`cursor-${cursor}-resize`) &&
			candidate.className.includes(position),
	);
	if (!found) {
		throw new Error(`no ${cursor} grip at ${position}`);
	}
	return found;
}

beforeEach(() => {
	installLocalStorage();
	window.innerWidth = 1440;
	window.innerHeight = 960;
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
				cwd: '/root/concierge',
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
	});
});

afterEach(() => {
	clearEnsemblrApi();
	vi.restoreAllMocks();
});

describe('resizing the docked Concierge', () => {
	test('grows from the bottom-right corner and takes the anchor with it', async () => {
		const store = createStore();
		renderOpenPanel(store);
		const panel = await screen.findByRole('region', { name: 'Concierge' });
		stubRect(panel, PANEL_RECT);

		dragGrip(grip(panel, 'nwse', 'right-0 bottom-0'), 80, 60);

		await waitFor(() => {
			expect(store.get(conciergePanelSizeAtom)).toEqual({
				height: 572,
				width: 496,
			});
		});
		// Leading edges fixed, so the corner it hangs from moved by the same delta.
		expect(store.get(conciergeAnchorAtom)).toEqual({ x: 896, y: 772 });
	});

	test('grows from the top-left corner without moving the anchor', async () => {
		const store = createStore();
		renderOpenPanel(store);
		const panel = await screen.findByRole('region', { name: 'Concierge' });
		stubRect(panel, PANEL_RECT);

		dragGrip(grip(panel, 'nwse', 'top-0 left-0'), -80, -60);

		await waitFor(() => {
			expect(store.get(conciergePanelSizeAtom)).toEqual({
				height: 572,
				width: 496,
			});
		});
		// Never dragged, so the panel is still free to re-dock on a window resize.
		expect(store.get(conciergeAnchorAtom)).toEqual({ x: -1, y: -1 });
	});

	test('moves one axis per edge grip', async () => {
		const store = createStore();
		renderOpenPanel(store);
		const panel = await screen.findByRole('region', { name: 'Concierge' });
		stubRect(panel, PANEL_RECT);

		dragGrip(grip(panel, 'ew', 'inset-y-4 right-0'), 120, 90);

		await waitFor(() => {
			expect(store.get(conciergePanelSizeAtom)).toEqual({
				height: PANEL_RECT.height,
				width: 536,
			});
		});
	});

	test('refuses to shrink below the shipped size', async () => {
		const store = createStore();
		renderOpenPanel(store);
		const panel = await screen.findByRole('region', { name: 'Concierge' });
		stubRect(panel, PANEL_RECT);

		dragGrip(grip(panel, 'nwse', 'right-0 bottom-0'), -400, -400);

		await waitFor(() => {
			expect(store.get(conciergePanelSizeAtom)).toEqual(
				CONCIERGE_MIN_PANEL_SIZE,
			);
		});
	});

	test('keeps the panel inside the window as it grows', async () => {
		const store = createStore();
		renderOpenPanel(store);
		const panel = await screen.findByRole('region', { name: 'Concierge' });
		stubRect(panel, PANEL_RECT);

		dragGrip(grip(panel, 'nwse', 'right-0 bottom-0'), 4_000, 4_000);

		await waitFor(() => {
			expect(store.get(conciergePanelSizeAtom)).toEqual({
				// Both capped by the distance from the fixed edge to the margin.
				height: window.innerHeight - 8 - PANEL_RECT.top,
				width: window.innerWidth - 8 - PANEL_RECT.left,
			});
		});
	});
});
