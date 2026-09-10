// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { expect, test, vi } from 'vitest';

import { SessionTabs } from '../../../src/renderer/components/workbench-shell/conversation-panel/session-tabs';
import { chatPlanModeAtomFamily } from '../../../src/renderer/state/preferences';
import type { SessionTabModel } from '../../../src/renderer/types/workbench';
import { renderWithProviders } from '../support/dom';

/** Builds a renderer-only chat fixture at an explicit presentation depth. */
function chatTab(id: string, delegationDepth?: 0 | 1 | 2): SessionTabModel {
	return {
		agentSessionId: `session-${id}`,
		chatTabId: id,
		delegationDepth,
		id,
		isPreview: false,
		isSubAgent: delegationDepth === 1 || delegationDepth === 2,
		kind: 'chat',
		label: id,
		status: 'idle',
		summary: '',
		updatedLabel: '2m ago',
	};
}

const root = chatTab('Root', 0);
const child = chatTab('Child', 1);
const leaf = chatTab('Leaf', 2);
const legacyChild = { ...chatTab('Legacy child'), isSubAgent: true };

/** Renders open and closed hierarchy fixtures through the production tab strip. */
function renderTabs({
	activeSession = root,
	onRestore = () => undefined,
	unreadKeys = new Set<string>(),
}: {
	activeSession?: SessionTabModel;
	onRestore?: (sessionId: string) => void;
	unreadKeys?: ReadonlySet<string>;
} = {}) {
	const store = createStore();
	store.set(chatPlanModeAtomFamily('Child'), true);
	return renderWithProviders(
		<Provider store={store}>
			<SessionTabs
				activeSession={activeSession}
				closedSessions={[chatTab('Closed child', 1), chatTab('Closed leaf', 2)]}
				onLaunchHarness={async () => null}
				onOpenArchitectureDiagram={async () => null}
				onSessionTabChange={() => undefined}
				onSessionTabClose={() => undefined}
				onSessionTabOpen={async () => null}
				onSessionTabPin={() => undefined}
				onSessionTabRestore={onRestore}
				onSessionTabsReorder={() => undefined}
				sessions={[root, child, leaf, legacyChild]}
				unreadKeys={unreadKeys}
			/>
		</Provider>,
	);
}

test('uses a leaf instead of arrows for second-level open and closed chats', async () => {
	const { container } = renderTabs();

	expect(
		container.querySelector('[data-tab-key="Root"] [data-agent-depth-cue]'),
	).toBeNull();
	expect(
		container.querySelector(
			'[data-tab-key="Legacy child"] [data-agent-depth-cue]',
		),
	).toBeNull();
	expect(
		container.querySelector('[data-tab-key="Legacy child"]')?.className,
	).toContain('w-8');
	expect(container.querySelector('.lucide-corner-down-right')).toBeNull();
	expect(
		container.querySelector('[data-tab-key="Child"] .lucide-bot'),
	).not.toBeNull();
	expect(
		container.querySelector('[data-tab-key="Leaf"] .lucide-leaf'),
	).not.toBeNull();

	await userEvent.click(
		screen.getByRole('button', { name: 'Open closed chat tabs' }),
	);
	expect(
		screen
			.getByRole('menuitem', { name: /Closed child/ })
			.querySelector('.lucide-bot'),
	).not.toBeNull();
	expect(
		screen
			.getByRole('menuitem', { name: /Closed leaf/ })
			.querySelector('.lucide-leaf'),
	).not.toBeNull();
});

test('keeps descendant compaction, mode, and unread presentation intact', () => {
	const { container, rerender } = renderTabs({ unreadKeys: new Set(['Leaf']) });
	const childTab = container.querySelector('[data-tab-key="Child"]');
	const leafTab = container.querySelector('[data-tab-key="Leaf"]');

	expect(childTab?.className).toContain('w-8');
	expect(
		childTab?.querySelector('[data-session-tab-mode="plan"]'),
	).not.toBeNull();
	expect(leafTab?.querySelector('[data-session-tab-unread]')).toHaveClass(
		'sr-only',
	);
	expect(leafTab?.querySelector('.rounded-full')).toBeNull();

	rerender(
		<SessionTabs
			activeSession={child}
			closedSessions={[]}
			onLaunchHarness={async () => null}
			onOpenArchitectureDiagram={async () => null}
			onSessionTabChange={() => undefined}
			onSessionTabClose={() => undefined}
			onSessionTabOpen={async () => null}
			onSessionTabPin={() => undefined}
			onSessionTabRestore={() => undefined}
			onSessionTabsReorder={() => undefined}
			sessions={[root, child, leaf]}
			unreadKeys={new Set(['Leaf'])}
		/>,
	);
	expect(
		container.querySelector('[data-tab-key="Child"]')?.className,
	).not.toContain('w-8');
});

test('keeps depth visible through distinct icon backgrounds in tabs and history', async () => {
	const { container } = renderTabs();
	expect(
		container.querySelector('[data-tab-key="Child"] .lucide-bot')
			?.parentElement,
	).toHaveClass('bg-accent');
	expect(
		container.querySelector('[data-tab-key="Leaf"] .lucide-leaf')
			?.parentElement,
	).toHaveClass('bg-status-ok/15');
	await userEvent.click(
		screen.getByRole('button', { name: 'Open closed chat tabs' }),
	);
	expect(
		screen
			.getByRole('menuitem', { name: /Closed leaf/ })
			.querySelector('.lucide-leaf')?.parentElement,
	).toHaveClass('bg-status-ok/15');
});

test('restores the selected closed descendant by its unchanged id', async () => {
	const onRestore = vi.fn();
	renderTabs({ onRestore });

	await userEvent.click(
		screen.getByRole('button', { name: 'Open closed chat tabs' }),
	);
	await userEvent.click(screen.getByRole('menuitem', { name: /Closed leaf/ }));

	expect(onRestore).toHaveBeenCalledWith('Closed leaf');
});
