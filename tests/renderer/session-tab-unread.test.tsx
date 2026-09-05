// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';

import { SessionTabs } from '../../src/renderer/components/workbench-shell/conversation-panel/session-tabs';
import type { SessionTabModel } from '../../src/renderer/types/workbench';
import { renderWithProviders } from './support/dom';

/** Builds a chat tab whose ids differ, so either can be matched independently. */
function chatTab(id: string, label: string): SessionTabModel {
	return {
		agentSessionId: `session-${id}`,
		chatTabId: id,
		id,
		isPreview: false,
		isSubAgent: false,
		kind: 'chat',
		label,
		status: 'idle',
		summary: '',
		updatedLabel: '2m ago',
	};
}

const activeTab = chatTab('tab-active', 'Active chat');
const otherTab = chatTab('tab-other', 'Background chat');

/** Renders the strip with the given ids marked unread. */
function renderStrip(unreadKeys: ReadonlySet<string>) {
	return renderWithProviders(
		<SessionTabs
			activeSession={activeTab}
			closedSessions={[]}
			onLaunchHarness={async () => null}
			onOpenArchitectureDiagram={async () => null}
			onSessionTabChange={() => undefined}
			onSessionTabClose={() => undefined}
			onSessionTabOpen={async () => null}
			onSessionTabPin={() => undefined}
			onSessionTabRestore={() => undefined}
			onSessionTabsReorder={() => undefined}
			sessions={[activeTab, otherTab]}
			unreadKeys={unreadKeys}
		/>,
	);
}

/** Reads the unread dot inside the tab with the given key, if it has one. */
function unreadDotIn(container: HTMLElement, tabKey: string) {
	return container
		.querySelector(`[data-tab-key="${tabKey}"]`)
		?.querySelector('[data-session-tab-unread]');
}

describe('session tab unread marker', () => {
	test('marks an inactive tab matched by its tab id', () => {
		const { container } = renderStrip(new Set(['tab-other']));
		expect(unreadDotIn(container, 'tab-other')).not.toBeNull();
	});

	test('marks an inactive tab matched by its session id alone', () => {
		const { container } = renderStrip(new Set(['session-tab-other']));
		expect(unreadDotIn(container, 'tab-other')).not.toBeNull();
	});

	test('never marks the active tab', () => {
		const { container } = renderStrip(
			new Set(['tab-active', 'session-tab-active']),
		);
		expect(unreadDotIn(container, 'tab-active')).toBeNull();
	});

	test('marks nothing when no chat is unread', () => {
		const { container } = renderStrip(new Set());
		expect(container.querySelector('[data-session-tab-unread]')).toBeNull();
	});

	test('lifts the unread tab label out of the muted text colour', () => {
		const { container } = renderStrip(new Set(['tab-other']));
		const label = container
			.querySelector('[data-tab-key="tab-other"]')
			?.querySelector('span[title="Background chat"]');
		expect(label?.className).toContain('text-foreground');
	});
});
