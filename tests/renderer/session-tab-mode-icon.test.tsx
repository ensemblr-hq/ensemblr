// @vitest-environment happy-dom
import { createStore, Provider } from 'jotai';
import { describe, expect, test } from 'vitest';

import { SessionTabs } from '../../src/renderer/components/workbench-shell/conversation-panel/session-tabs';
import {
	chatAfkModeAtomFamily,
	chatPlanModeAtomFamily,
} from '../../src/renderer/state/preferences';
import type { SessionTabModel } from '../../src/renderer/types/workbench';
import { renderWithProviders } from './support/dom';

/** Builds a chat tab whose chat id matches its tab key, for per-tab atom writes. */
function chatTab(
	id: string,
	status: SessionTabModel['status'] = 'idle',
): SessionTabModel {
	return {
		agentSessionId: `session-${id}`,
		chatTabId: id,
		id,
		isPreview: false,
		isSubAgent: false,
		kind: 'chat',
		label: id,
		status,
		summary: '',
		updatedLabel: '2m ago',
	};
}

/** Builds a harness terminal tab, the modeless kind the icon must skip. */
function terminalTab(
	id: string,
	status: SessionTabModel['status'] = 'idle',
): SessionTabModel {
	return {
		agentSessionId: `session-${id}`,
		chatTabId: id,
		harnessId: 'claude-code',
		harnessLabel: 'Claude Code',
		harnessSessionId: null,
		id,
		isPreview: false,
		isSubAgent: false,
		kind: 'terminal',
		label: id,
		status,
		summary: '',
		terminalId: `pty-${id}`,
		updatedLabel: '2m ago',
	};
}

/** Reads the spinner a tab draws while it is working. */
function spinnerIn(container: HTMLElement, tabKey: string) {
	return container.querySelector(
		`[data-tab-key="${tabKey}"] .lucide-loader-circle`,
	);
}

/**
 * Renders the strip around a single tab, which is also the active one, over a
 * store the test owns. The per-chat mode atoms are `atomWithStorage` held in a
 * module-level family, so seeding the default store would outlive the test and
 * reach every later file in the same worker.
 */
function stripFor(
	store: ReturnType<typeof createStore>,
	session: SessionTabModel,
) {
	return (
		<Provider store={store}>
			<SessionTabs
				activeSession={session}
				closedSessions={[]}
				onLaunchHarness={async () => null}
				onOpenArchitectureDiagram={async () => null}
				onSessionTabChange={() => undefined}
				onSessionTabClose={() => undefined}
				onSessionTabOpen={async () => null}
				onSessionTabPin={() => undefined}
				onSessionTabRestore={() => undefined}
				onSessionTabsReorder={() => undefined}
				sessions={[session]}
				unreadKeys={new Set()}
			/>
		</Provider>
	);
}

/** Reads the mode-marked icon inside the tab with the given key, if it has one. */
function modeIconIn(container: HTMLElement, tabKey: string) {
	return (
		container
			.querySelector(`[data-tab-key="${tabKey}"]`)
			?.querySelector('[data-session-tab-mode]') ?? null
	);
}

describe('session tab turn-mode icon', () => {
	test('an AFK chat swaps its glyph for the away-tinted keyboard-off mark', () => {
		const store = createStore();
		store.set(chatAfkModeAtomFamily('tab-afk'), true);
		const { container } = renderWithProviders(
			stripFor(store, chatTab('tab-afk')),
		);

		const icon = modeIconIn(container, 'tab-afk');
		expect(icon).not.toBeNull();
		expect(icon?.getAttribute('data-session-tab-mode')).toBe('afk');
		expect(icon?.classList.contains('lucide-keyboard-off')).toBe(true);
		expect(icon?.classList.contains('text-status-away')).toBe(true);
	});

	test('a planning chat swaps its glyph for the accent-tinted map mark', () => {
		const store = createStore();
		store.set(chatPlanModeAtomFamily('tab-plan'), true);
		const { container } = renderWithProviders(
			stripFor(store, chatTab('tab-plan')),
		);

		const icon = modeIconIn(container, 'tab-plan');
		expect(icon?.getAttribute('data-session-tab-mode')).toBe('plan');
		expect(icon?.classList.contains('lucide-map')).toBe(true);
		expect(icon?.classList.contains('text-accent-strong')).toBe(true);
	});

	test('a chat in neither mode keeps its ordinary glyph', () => {
		const store = createStore();
		const { container } = renderWithProviders(
			stripFor(store, chatTab('tab-plain')),
		);

		expect(modeIconIn(container, 'tab-plain')).toBeNull();
		expect(
			container.querySelector(
				'[data-tab-key="tab-plain"] .lucide-message-square',
			),
		).not.toBeNull();
	});

	test('switching a mode off restores the ordinary glyph', () => {
		const store = createStore();
		store.set(chatAfkModeAtomFamily('tab-reverted'), true);
		const { container, rerender } = renderWithProviders(
			stripFor(store, chatTab('tab-reverted')),
		);
		expect(modeIconIn(container, 'tab-reverted')).not.toBeNull();

		store.set(chatAfkModeAtomFamily('tab-reverted'), false);
		rerender(stripFor(store, chatTab('tab-reverted')));

		expect(modeIconIn(container, 'tab-reverted')).toBeNull();
		expect(
			container.querySelector(
				'[data-tab-key="tab-reverted"] .lucide-message-square',
			),
		).not.toBeNull();
	});

	test('a working chat keeps its spinner and takes the mode tint', () => {
		const store = createStore();
		store.set(chatAfkModeAtomFamily('tab-working'), true);
		const { container } = renderWithProviders(
			stripFor(store, chatTab('tab-working', 'working')),
		);

		const icon = modeIconIn(container, 'tab-working');
		expect(icon?.classList.contains('animate-spin')).toBe(true);
		expect(icon?.classList.contains('text-status-away')).toBe(true);
	});

	test('planning wins when a chat somehow carries both modes', () => {
		const store = createStore();
		store.set(chatAfkModeAtomFamily('tab-both'), true);
		store.set(chatPlanModeAtomFamily('tab-both'), true);
		const { container } = renderWithProviders(
			stripFor(store, chatTab('tab-both')),
		);

		const icon = modeIconIn(container, 'tab-both');
		expect(icon?.getAttribute('data-session-tab-mode')).toBe('plan');
		expect(icon?.classList.contains('lucide-map')).toBe(true);
		expect(icon?.classList.contains('text-accent-strong')).toBe(true);
	});

	test('a non-chat tab reads no mode even when its id carries one', () => {
		const store = createStore();
		store.set(chatAfkModeAtomFamily('tab-terminal'), true);
		const { container } = renderWithProviders(
			stripFor(store, terminalTab('tab-terminal')),
		);

		expect(modeIconIn(container, 'tab-terminal')).toBeNull();
	});
});

describe('session tab turn-mode icon accessible name', () => {
	test('a mode glyph announces its mode instead of hiding from the reader', () => {
		const store = createStore();
		store.set(chatPlanModeAtomFamily('tab-named'), true);
		const { container } = renderWithProviders(
			stripFor(store, chatTab('tab-named')),
		);

		const icon = modeIconIn(container, 'tab-named');
		expect(icon?.getAttribute('role')).toBe('img');
		expect(icon?.getAttribute('aria-label')).toBe('Planning');
		expect(icon?.getAttribute('aria-hidden')).toBeNull();
	});

	test('a working chat in a mode announces it, since only a tint marks it', () => {
		const store = createStore();
		store.set(chatAfkModeAtomFamily('tab-named-working'), true);
		const { container } = renderWithProviders(
			stripFor(store, chatTab('tab-named-working', 'working')),
		);

		const icon = modeIconIn(container, 'tab-named-working');
		expect(icon?.getAttribute('role')).toBe('img');
		expect(icon?.getAttribute('aria-label')).toBe('Unattended');
	});

	test('a modeless working spinner stays hidden from the reader', () => {
		const store = createStore();
		const { container } = renderWithProviders(
			stripFor(store, chatTab('tab-silent', 'working')),
		);

		const spinner = spinnerIn(container, 'tab-silent');
		expect(spinner?.getAttribute('aria-hidden')).toBe('true');
		expect(spinner?.getAttribute('aria-label')).toBeNull();
		expect(spinner?.getAttribute('role')).toBeNull();
		expect(spinner?.getAttribute('data-session-tab-mode')).toBeNull();
	});

	test('a modeless working chat draws the same spinner a modeless kind does', () => {
		const chatStore = createStore();
		const chat = renderWithProviders(
			stripFor(chatStore, chatTab('same-spinner', 'working')),
		);
		const chatSpinner = spinnerIn(chat.container, 'same-spinner');
		chat.unmount();

		const terminalStore = createStore();
		const { container } = renderWithProviders(
			stripFor(terminalStore, terminalTab('same-spinner', 'working')),
		);

		expect(chatSpinner?.outerHTML).toBe(
			spinnerIn(container, 'same-spinner')?.outerHTML,
		);
	});

	test('the tab button folds the mode into its own accessible name', () => {
		const store = createStore();
		store.set(chatPlanModeAtomFamily('tab-named-button'), true);
		const { container } = renderWithProviders(
			stripFor(store, chatTab('tab-named-button')),
		);

		const button = container.querySelector(
			'[data-tab-key="tab-named-button"] button',
		);
		expect(button).toHaveAccessibleName('Planning tab-named-button');
	});
});
