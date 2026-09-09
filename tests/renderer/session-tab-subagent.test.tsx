// @vitest-environment happy-dom
import { createStore, Provider } from 'jotai';
import { describe, expect, test } from 'vitest';

import { SessionTabs } from '../../src/renderer/components/workbench-shell/conversation-panel/session-tabs';
import { chatAfkModeAtomFamily } from '../../src/renderer/state/preferences';
import type { SessionTabModel } from '../../src/renderer/types/workbench';
import { renderWithProviders } from './support/dom';

/** Builds a chat tab fixture for compact sub-agent strip assertions. */
function chatTab(id: string, isSubAgent = false): SessionTabModel {
	return {
		agentSessionId: `session-${id}`,
		chatTabId: id,
		id,
		isPreview: false,
		isSubAgent,
		kind: 'chat',
		label: id === 'child' ? 'Child task' : 'Parent task',
		status: 'idle',
		summary: '',
		updatedLabel: '',
	};
}

/** Renders the production strip with one root and one spawned child. */
function renderStrip(activeId: string, childIsAfk = false) {
	const sessions = [chatTab('parent'), chatTab('child', true)];
	const activeSession = sessions.find((session) => session.id === activeId);
	if (!activeSession) {
		throw new Error(`Missing fixture ${activeId}`);
	}
	const store = createStore();
	if (childIsAfk) {
		store.set(chatAfkModeAtomFamily('child'), true);
	}
	return renderWithProviders(
		<Provider store={store}>
			<SessionTabs
				activeSession={activeSession}
				closedSessions={[]}
				onLaunchHarness={async () => null}
				onOpenArchitectureDiagram={async () => null}
				onSessionTabChange={() => undefined}
				onSessionTabClose={() => undefined}
				onSessionTabOpen={async () => null}
				onSessionTabPin={() => undefined}
				onSessionTabRestore={() => undefined}
				onSessionTabsReorder={() => undefined}
				sessions={sessions}
				unreadKeys={new Set()}
			/>
		</Provider>,
	);
}

describe('sub-agent session tabs', () => {
	test('compacts an inactive child and removes its close control', () => {
		const { container } = renderStrip('parent');
		const child = container.querySelector('[data-tab-key="child"]');

		expect(child?.className).toContain('w-8');
		expect(child?.querySelector('.lucide-bot')).not.toBeNull();
		expect(child?.querySelector('button')).toHaveAccessibleName('Child task');
		expect(child?.querySelector('button[aria-label*="Close"]')).toBeNull();
	});

	test('keeps the child mode in its compact accessible name', () => {
		const { container } = renderStrip('parent', true);
		const childButton = container.querySelector(
			'[data-tab-key="child"] button',
		);

		expect(childButton).toHaveAccessibleName('Unattended Child task');
	});

	test('expands the active child and exposes its normal close control', () => {
		const { container } = renderStrip('child');
		const child = container.querySelector('[data-tab-key="child"]');

		expect(child?.className).not.toContain('w-8');
		expect(child?.querySelector('span.truncate')).toHaveTextContent(
			'Child task',
		);
		expect(child?.querySelector('button[aria-label*="Close"]')).not.toBeNull();
	});
});
