// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	type MockInstance,
	test,
	vi,
} from 'vitest';

import { ConciergeLauncher } from '@/renderer/components/concierge';
import { SidebarProvider } from '@/renderer/components/ui/sidebar';
import { TOOLBAR_HEIGHT_CLASS } from '@/renderer/lib/workbench/shell-inset';
import { formatShortcut, matchesShortcut } from '@/shared/keymap';

import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	installLocalStorage,
} from '../support/dom';

/**
 * Renders the launcher with a `QueryClientProvider`, a fresh Jotai store, and
 * the sidebar context its maximized header reads — and nothing else.
 *
 * Deliberately not `renderWithProviders`, which installs a `TooltipProvider` of
 * its own: the Concierge brings its own, and an ambient one would hide the
 * failure this file exists to catch. `SidebarProvider` is the one piece of shell
 * context it does need, because maximizing covers the sidebar's own expand
 * trigger and the panel offers a replacement in its place.
 *
 * The store is per-render because the presentation atom is module-scoped, so
 * without one a test that opens the panel leaves it open for the next.
 */
function renderBare({
	sidebarOpen = true,
	store = createStore(),
}: {
	sidebarOpen?: boolean;
	store?: ReturnType<typeof createStore>;
} = {}) {
	return render(
		<QueryClientProvider client={createTestQueryClient()}>
			<Provider store={store}>
				<SidebarProvider defaultOpen={sidebarOpen}>
					<ConciergeLauncher />
				</SidebarProvider>
			</Provider>
		</QueryClientProvider>,
	);
}

/**
 * Whichever physical key `mod` resolves to here. happy-dom reports an X11
 * platform, so the keymap treats the run as non-macOS and binds Ctrl — asking
 * the matcher is what keeps these presses right on either.
 */
const MOD = matchesShortcut('concierge.toggle', {
	altKey: false,
	ctrlKey: false,
	key: 'c',
	metaKey: true,
	shiftKey: true,
})
	? 'Meta'
	: 'Control';

/** Types one `mod`-modified chord, with Shift held when the binding wants it. */
function pressMod(key: string, { shift = false }: { shift?: boolean } = {}) {
	const inner = shift ? `{Shift>}${key}{/Shift}` : key;
	return userEvent.keyboard(`{${MOD}>}${inner}{/${MOD}}`);
}

let submitPrompt = vi.fn();
let clearContext = vi.fn();

beforeEach(() => {
	installLocalStorage();
	submitPrompt = vi.fn().mockResolvedValue({});
	clearContext = vi.fn().mockResolvedValue({ session: null });
	installEnsemblrApi({
		conciergeContextPressure: vi.fn().mockResolvedValue({
			maxTokens: 200_000,
			overThreshold: false,
			percent: 12,
			thresholdPercent: 80,
			usedTokens: 24_000,
		}),
		listAgentProviderSlashCommands: vi.fn().mockResolvedValue({ commands: [] }),
		listAgentModels: vi.fn().mockResolvedValue({
			defaultModelId: null,
			defaultThinkingLevel: null,
			models: [],
		}),
		listConciergeEvents: vi.fn().mockResolvedValue({
			events: [
				{
					createdAt: '2026-08-24T00:00:01.000Z',
					eventType: 'message',
					id: 'evt-1',
					ordinal: 0,
					payload: {
						kind: 'message',
						payload: { kind: 'text', text: 'Reading the board.' },
						role: 'agent',
					},
					sessionId: 'concierge-1',
					stream: 'protocol',
				},
			],
		}),
		clearConciergeContext: clearContext,
		onConciergeSessionEvent: vi.fn().mockReturnValue(() => undefined),
		submitConciergePrompt: submitPrompt,
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
});

describe('the Concierge launcher', () => {
	test('opens its panel without an ambient TooltipProvider', async () => {
		renderBare();

		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);

		// The composer reuses the workspace composer's model and thinking pickers,
		// and both render tooltips — so before the launcher carried its own
		// provider, this click threw "`Tooltip` must be used within
		// `TooltipProvider`" and the panel never appeared.
		expect(
			await screen.findByRole('region', { name: 'Concierge' }),
		).toBeVisible();
	});

	test('anchors the composer placeholder to the editor, not the panel', async () => {
		renderBare();

		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);
		const placeholder = await screen.findByText('Ask across every project…');

		// The editor renders its placeholder `absolute top-0 left-0`, so it needs a
		// positioned ancestor of its own. Without one it escaped the composer
		// entirely and painted over the panel's header.
		expect(placeholder.closest('.relative')).not.toBeNull();
	});

	test('carries the workspace composer\u2019s controls', async () => {
		renderBare();

		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);
		await screen.findByRole('region', { name: 'Concierge' });

		// The attachment menu is what drag-and-drop and the file picker hang off,
		// and the context gauge only renders once the runtime has reported a
		// window — the stub above reports one.
		expect(screen.getByRole('button', { name: 'Attachments' })).toBeVisible();
		expect(
			await screen.findByRole('button', { name: 'Context usage' }),
		).toBeVisible();
	});

	test('reads at a column width once maximized, not the full pane', async () => {
		renderBare();

		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);
		const panel = await screen.findByRole('region', { name: 'Concierge' });
		await screen.findByText('Reading the board.');
		expect(panel.querySelector('.max-w-3xl')).toBeNull();

		await userEvent.click(screen.getByRole('button', { name: 'Maximize' }));

		// Maximizing covers the whole content pane, which on a wide display is far
		// past a readable measure — so the transcript and the composer take the
		// same columns the workspace chat uses rather than stretching edge to edge.
		expect(panel.querySelector('.max-w-3xl')).not.toBeNull();
		expect(panel.querySelector('.max-w-4xl')).not.toBeNull();
		// Maximized, the header sits beside the navigation sidebar's own, so it
		// takes the shell toolbar's height rather than its own compact one.
		expect(panel.querySelector('header')).toHaveClass(TOOLBAR_HEIGHT_CLASS);
	});

	test('maximizes on a double-click of its docked title bar', async () => {
		renderBare();

		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);
		const panel = await screen.findByRole('region', { name: 'Concierge' });
		const header = panel.querySelector('header');
		if (!header) {
			throw new Error('the panel rendered no header');
		}

		await userEvent.dblClick(header);
		expect(panel).toHaveAttribute('data-concierge-presentation', 'fullscreen');

		// Maximized, the header spans the window's own title area, where macOS has
		// already claimed the double-click for zoom — so it hands the gesture back
		// and the button beside it is what restores the panel.
		await userEvent.dblClick(header);
		expect(panel).toHaveAttribute('data-concierge-presentation', 'fullscreen');

		await userEvent.click(
			screen.getByRole('button', { name: 'Restore panel' }),
		);
		expect(panel).toHaveAttribute('data-concierge-presentation', 'panel');
	});

	test('leaves the title bar alone when a header control is double-clicked', async () => {
		renderBare();

		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);
		const panel = await screen.findByRole('region', { name: 'Concierge' });

		// Every header control sits on the title bar, so a double-click of one
		// would otherwise fire the control twice *and* the bar underneath it. The
		// maximize button is what makes that visible: unguarded, its own two clicks
		// plus the bar's would land the panel back where it started.
		await userEvent.dblClick(screen.getByRole('button', { name: 'Maximize' }));

		expect(panel).toHaveAttribute('data-concierge-presentation', 'panel');
		expect(
			screen.getByRole('button', { name: 'Maximize' }),
		).toBeInTheDocument();
	});

	test('offers a way back to a collapsed sidebar once maximized', async () => {
		renderBare({ sidebarOpen: false });

		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);
		await screen.findByRole('region', { name: 'Concierge' });
		expect(
			screen.queryAllByRole('button', { name: 'Show the sidebar' }),
		).toHaveLength(0);

		await userEvent.click(screen.getByRole('button', { name: 'Maximize' }));

		// Maximized, the panel covers both the toolbar hosting the shell's expand
		// trigger and the rail at the window's leading edge — so the header carries
		// a trigger and the panel carries an edge strip until the sidebar is back.
		const [trigger, rail] = screen.getAllByRole('button', {
			name: 'Show the sidebar',
		});
		expect(rail).toBeInTheDocument();
		await userEvent.click(trigger);

		expect(
			screen.queryAllByRole('button', { name: 'Show the sidebar' }),
		).toHaveLength(0);
		// The edge strip stays once the sidebar is back — it is the only way to
		// close it again from here, exactly as the shell's own rail behaves.
		expect(
			screen.getByRole('button', { name: 'Hide the sidebar' }),
		).toBeInTheDocument();
	});

	test('hides the launcher while the panel is open', async () => {
		renderBare();

		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);
		await screen.findByRole('region', { name: 'Concierge' });

		expect(
			screen.queryByRole('button', { name: 'Open the Concierge' }),
		).not.toBeInTheDocument();
	});

	test('keeps the session usable after the shell unmounts it', async () => {
		const store = createStore();
		const { unmount } = renderBare({ store });
		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);
		await screen.findByRole('region', { name: 'Concierge' });

		// Settings is a sibling of the shell layout the launcher mounts in, so a
		// trip there unmounts the whole Concierge while the store outlives it. The
		// session's cwd used to live in the hook's own state and came back null,
		// which disables every control on the composer with no error to explain it.
		unmount();
		renderBare({ store });
		await screen.findByRole('region', { name: 'Concierge' });

		expect(
			await screen.findByRole('button', { name: 'Attachments' }),
		).toBeEnabled();
	});

	test('closes the panel and brings the launcher back', async () => {
		renderBare();

		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);
		await screen.findByRole('region', { name: 'Concierge' });
		await userEvent.click(screen.getByRole('button', { name: 'Close' }));

		expect(
			screen.queryByRole('region', { name: 'Concierge' }),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		).toBeVisible();
	});
});

describe('the Concierge shortcuts', () => {
	test('opens and closes the panel on its own chord', async () => {
		renderBare();

		await pressMod('c', { shift: true });
		expect(
			await screen.findByRole('region', { name: 'Concierge' }),
		).toBeVisible();

		await pressMod('c', { shift: true });
		expect(
			screen.queryByRole('region', { name: 'Concierge' }),
		).not.toBeInTheDocument();
	});

	test('maximizes straight from closed, so the chord never needs the panel first', async () => {
		renderBare();

		await pressMod('m', { shift: true });

		const panel = await screen.findByRole('region', { name: 'Concierge' });
		expect(panel).toHaveAttribute('data-concierge-presentation', 'fullscreen');
	});

	test('opens the panel on the focus-composer chord, composer and all', async () => {
		renderBare();

		await pressMod('l', { shift: true });

		// The chord targets the composer, which only exists once the panel is up —
		// so opening is half of what it does, and the request it leaves behind is
		// consumed by the composer that mounts with it.
		await screen.findByRole('region', { name: 'Concierge' });
		expect(
			await screen.findByRole('textbox', { name: 'Message the Concierge' }),
		).toBeVisible();
	});

	test('clears the context from inside the panel, not from the window', async () => {
		renderBare();

		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);
		await screen.findByRole('region', { name: 'Concierge' });

		// Focus outside the Concierge first: the chord throws a conversation away,
		// so it must not fire while the user is typing in a workspace chat with the
		// Concierge merely open behind it.
		document.body.focus();
		await pressMod('k', { shift: true });
		expect(clearContext).not.toHaveBeenCalled();

		await userEvent.click(
			await screen.findByRole('textbox', { name: 'Message the Concierge' }),
		);
		await pressMod('k', { shift: true });

		await waitFor(() => expect(clearContext).toHaveBeenCalled());
	});

	test('closes on Escape from inside the panel', async () => {
		renderBare();

		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);
		const editor = await screen.findByRole('textbox', {
			name: 'Message the Concierge',
		});
		await userEvent.click(editor);
		await userEvent.keyboard('{Escape}');

		expect(
			screen.queryByRole('region', { name: 'Concierge' }),
		).not.toBeInTheDocument();
	});
});

describe('the Concierge composer', () => {
	test('sends on \u2318\u21b5 whichever send shortcut is configured', async () => {
		renderBare();

		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);
		const editor = await screen.findByRole('textbox', {
			name: 'Message the Concierge',
		});
		await userEvent.click(editor);
		// Pasted rather than typed: happy-dom delivers no `beforeinput` for
		// synthetic keystrokes, so Lexical never sees typed characters at all.
		await userEvent.paste('status of the board');
		await pressMod('{Enter}');

		// The default setting is bare Enter, and \u2318\u21b5 has to keep working under
		// it \u2014 a workspace chat binds both chords and the Concierge composer is
		// the same box, so the setting decides what plain Enter means rather than
		// which chords exist at all.
		await waitFor(() =>
			expect(submitPrompt).toHaveBeenCalledWith(
				expect.objectContaining({ prompt: 'status of the board' }),
			),
		);
	});

	test('sends on a bare Enter under the default setting', async () => {
		renderBare();

		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);
		const editor = await screen.findByRole('textbox', {
			name: 'Message the Concierge',
		});
		await userEvent.click(editor);
		await userEvent.paste('what is running');
		await userEvent.keyboard('{Enter}');

		await waitFor(() =>
			expect(submitPrompt).toHaveBeenCalledWith(
				expect.objectContaining({ prompt: 'what is running' }),
			),
		);
	});

	test('names the configured send chord on the send button', async () => {
		renderBare();

		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);
		const editor = await screen.findByRole('textbox', {
			name: 'Message the Concierge',
		});
		await userEvent.click(editor);
		await userEvent.paste('hello');
		await userEvent.hover(screen.getByRole('button', { name: 'Send' }));

		// The chord the tooltip names is whatever the Send shortcut setting
		// resolves to, so the button stops contradicting the composer the moment
		// that setting moves.
		expect(await screen.findByText('Send message')).toBeVisible();
		expect(
			await screen.findByText(formatShortcut('composer.submit')),
		).toBeVisible();
	});
});

describe('the Concierge anchor', () => {
	test('opens the panel on the corner the bubble was dragged to', async () => {
		renderBare();
		const bubble = screen.getByRole('button', { name: 'Open the Concierge' });
		expect(bubble).toHaveStyle({ left: '964px', top: '628px' });

		dragBy(bubble, { x: -300, y: -100 });

		expect(bubble).toHaveStyle({ left: '664px', top: '528px' });
		await userEvent.click(bubble);

		// Both surfaces hang their bottom-right corner from one stored point, so
		// the panel opens where the bubble was rather than back at its own dock:
		// the bubble's corner is (708, 572), and the panel is 416×512.
		const panel = await screen.findByRole('region', { name: 'Concierge' });
		expect(panel).toHaveStyle({ left: '292px', top: '60px' });
	});

	test('brings the bubble back on the corner the panel was dragged to', async () => {
		renderBare();
		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);
		const panel = await screen.findByRole('region', { name: 'Concierge' });
		const header = panel.querySelector('header');
		if (!header) {
			throw new Error('the panel renders no header to drag by');
		}

		dragBy(header, { x: -200, y: -100 });
		expect(panel).toHaveStyle({ left: '392px', top: '60px' });
		await userEvent.click(screen.getByRole('button', { name: 'Close' }));

		// The panel's corner is (808, 572), and the bubble is 44×44.
		expect(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		).toHaveStyle({ left: '764px', top: '528px' });
	});

	test('returns to its anchored corner after a trip through fullscreen', async () => {
		renderBare();
		await userEvent.click(
			screen.getByRole('button', { name: 'Open the Concierge' }),
		);
		const panel = await screen.findByRole('region', { name: 'Concierge' });

		await userEvent.click(screen.getByRole('button', { name: 'Maximize' }));
		await userEvent.click(
			screen.getByRole('button', { name: 'Restore panel' }),
		);

		// Maximized, the shell inset owns the panel's placement and the anchor
		// stands down — so restoring has to re-apply it, or the panel comes back
		// with the offsets React cleared on the way out and pins to the corner.
		expect(panel).toHaveStyle({ left: '592px', top: '160px' });
	});

	test('does not transition the offsets it is dragged by', () => {
		renderBare();
		const bubble = screen.getByRole('button', { name: 'Open the Concierge' });

		// The button's base style transitions every property, `left` and `top`
		// among them — which had the bubble easing toward the cursor a transition
		// duration behind it while the panel, a plain section, tracked it exactly.
		// `transform` is on the named list because the hover lift is a scale, which
		// the drag never writes.
		expect(bubble).not.toHaveClass('transition-all');
		expect(bubble).toHaveClass(
			'transition-[background-color,border-color,box-shadow,transform]',
		);
	});

	test('moves the bubble without opening the panel', () => {
		renderBare();
		const bubble = screen.getByRole('button', { name: 'Open the Concierge' });

		dragBy(bubble, { x: -120, y: -80 });

		// The bubble is both a drag handle and a button, so the click its own
		// pointer-up produces has to be swallowed — otherwise every reposition
		// opens the panel.
		expect(
			screen.queryByRole('region', { name: 'Concierge' }),
		).not.toBeInTheDocument();
	});

	test('persists the anchor once per drag, not once per pointer move', () => {
		renderBare();
		const bubble = screen.getByRole('button', { name: 'Open the Concierge' });
		const setItem = vi.spyOn(window.localStorage, 'setItem');

		fireEvent.pointerDown(bubble, { clientX: 600, clientY: 600 });
		for (const step of [40, 80, 120, 160, 200]) {
			fireEvent.pointerMove(window, {
				clientX: 600 - step,
				clientY: 600 - step,
			});
			// The node follows the pointer inside the move itself: the gesture writes
			// `left`/`top` straight onto it, so nothing waits on a React render.
			expect(bubble).toHaveStyle({
				left: `${964 - step}px`,
				top: `${628 - step}px`,
			});
		}
		expect(anchorWrites(setItem)).toHaveLength(0);

		fireEvent.pointerUp(window, { clientX: 400, clientY: 400 });

		// A write per move meant a synchronous `localStorage` round trip on every
		// pointer event, which is what left the bubble trailing the cursor.
		expect(anchorWrites(setItem)).toEqual(['{"x":808,"y":472}']);
	});
});

/**
 * Drags an element by a delta far enough to pass the gesture's threshold,
 * including the click a browser synthesizes from the pointer-up that ends it.
 */
function dragBy(handle: Element, delta: { x: number; y: number }) {
	const origin = { x: 600, y: 600 };
	const end = { x: origin.x + delta.x, y: origin.y + delta.y };
	fireEvent.pointerDown(handle, { clientX: origin.x, clientY: origin.y });
	fireEvent.pointerMove(window, { clientX: end.x, clientY: end.y });
	fireEvent.pointerUp(window, { clientX: end.x, clientY: end.y });
	fireEvent.click(handle, { clientX: end.x, clientY: end.y });
}

/** The values a `setItem` spy was handed for the Concierge anchor key. */
function anchorWrites(setItem: MockInstance<Storage['setItem']>): string[] {
	return setItem.mock.calls
		.filter(([key]) => key === 'concierge_anchor')
		.map(([, value]) => value);
}
