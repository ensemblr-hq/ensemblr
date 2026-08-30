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
import { conciergePresentationAtom } from '@/renderer/state/concierge';
import type { ConciergeSessionEventWire } from '@/shared/ipc/contracts/concierge';
import type { TextContextMenuTarget } from '@/shared/ipc/contracts/text-editing';

import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	installLocalStorage,
} from '../support/dom';

/**
 * The chord label the context menu renders on the running platform: the macOS
 * glyph run, or the `Ctrl+…` spelling everywhere else. Written out rather than
 * taken from `formatChord`, so the assertion states the expected mapping
 * instead of restating the formatter's own output.
 */
function chord(key: string, shifted = false): string {
	return process.platform === 'darwin'
		? `${shifted ? '⇧' : ''}⌘${key}`
		: `Ctrl+${shifted ? 'Shift+' : ''}${key}`;
}

const ANSWER_TEXT = 'an answer worth keeping';

/** One assistant answer, as the Concierge's transcript stores it. */
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
	sessionId: 'concierge-1',
	stream: 'protocol',
};

const SESSION = {
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
};

const SESSION_FAILURE = 'The Concierge could not reach its runtime.';

const listeners = new Set<(payload: TextContextMenuTarget) => void>();
const openConciergeSession = vi.fn();

/** The payload main sends for a right-click on read-only prose. */
function target(
	overrides: Partial<TextContextMenuTarget> = {},
): TextContextMenuTarget {
	return {
		canCopy: true,
		canCut: true,
		canPaste: true,
		canRedo: true,
		canSelectAll: true,
		canUndo: true,
		dictionarySuggestions: [],
		isEditable: false,
		misspelledWord: '',
		selectionText: ANSWER_TEXT,
		x: 10,
		y: 20,
		...overrides,
	};
}

/**
 * Opens the whole panel — transcript and composer both — so the two menus it
 * mounts are live at once, which is the arrangement each has to tell itself
 * apart in.
 * @returns The panel element and the store its presentation lives in.
 */
async function renderPanel() {
	const store = createStore();
	store.set(conciergePresentationAtom, 'panel');
	render(
		<QueryClientProvider client={createTestQueryClient()}>
			<Provider store={store}>
				<SidebarProvider defaultOpen>
					<ConciergeLauncher />
				</SidebarProvider>
			</Provider>
		</QueryClientProvider>,
	);
	await screen.findByText(ANSWER_TEXT);
	return { panel: screen.getByRole('region', { name: 'Concierge' }), store };
}

/**
 * Delivers a right-click on one element the way the main process would: to
 * every mounted menu at once, each of which decides for itself whether the
 * click landed in its own subtree.
 */
async function rightClick(hit: Element, payload: TextContextMenuTarget) {
	vi.spyOn(document, 'elementFromPoint').mockReturnValue(hit);
	await act(async () => {
		for (const listener of listeners) {
			listener(payload);
		}
	});
}

/** Reads the open menu's rows in order, label plus shortcut as rendered. */
function menuRows(): (string | null)[] {
	return screen.getAllByRole('menuitem').map((item) => item.textContent);
}

/** Presses ⎋ on the open menu and waits for it to go. */
async function dismissMenu() {
	await act(async () => {
		fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
	});
	await waitFor(() => {
		expect(screen.queryByRole('menuitem')).toBeNull();
	});
}

beforeEach(() => {
	listeners.clear();
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
		listConciergeEvents: vi.fn().mockResolvedValue({ events: [ANSWER] }),
		onConciergeSessionEvent: vi.fn().mockReturnValue(() => undefined),
		onTextContextMenu: (listener: (payload: TextContextMenuTarget) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		openConciergeSession,
	});
	openConciergeSession.mockResolvedValue({ session: SESSION });
});

afterEach(() => {
	vi.restoreAllMocks();
	clearEnsemblrApi();
});

describe('the Concierge panel context menus', () => {
	test('right-clicking an answer offers the read-only text commands', async () => {
		await renderPanel();

		await rightClick(screen.getByText(ANSWER_TEXT), target());

		expect(menuRows()).toEqual([`Copy${chord('C')}`, 'Select all']);
	});

	test('each surface answers only for its own subtree', async () => {
		await renderPanel();

		await rightClick(
			screen.getByRole('textbox', { name: 'Message the Concierge' }),
			target({ isEditable: true, selectionText: 'draft' }),
		);

		expect(screen.getAllByRole('menu')).toHaveLength(1);
		expect(menuRows()).toEqual([
			`Undo${chord('Z')}`,
			`Redo${chord('Z', true)}`,
			`Cut${chord('X')}`,
			`Copy${chord('C')}`,
			`Paste${chord('V')}`,
			`Select all${chord('A')}`,
		]);

		await dismissMenu();
		await rightClick(screen.getByText(ANSWER_TEXT), target());

		expect(screen.getAllByRole('menu')).toHaveLength(1);
		expect(menuRows()).toEqual([`Copy${chord('C')}`, 'Select all']);
	});

	test('right-clicking the failure line offers the read-only commands', async () => {
		openConciergeSession.mockResolvedValue({
			error: SESSION_FAILURE,
			session: SESSION,
		});
		await renderPanel();

		await rightClick(
			await screen.findByRole('alert'),
			target({ selectionText: SESSION_FAILURE }),
		);

		expect(menuRows()).toEqual([`Copy${chord('C')}`, 'Select all']);
	});

	test('dismissing the transcript menu leaves the panel open and focused', async () => {
		const { panel, store } = await renderPanel();

		await rightClick(screen.getByText(ANSWER_TEXT), target());
		await screen.findAllByRole('menuitem');

		await dismissMenu();

		expect(store.get(conciergePresentationAtom)).toBe('panel');
		expect(panel.contains(document.activeElement)).toBe(true);
	});
});
