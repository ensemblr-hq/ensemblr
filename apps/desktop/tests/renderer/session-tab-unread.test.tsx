// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';

import { SessionTabs } from '../../src/renderer/components/workbench-shell/conversation-panel/session-tabs';
import type { SessionTabModel } from '../../src/renderer/types/workbench';
import { renderWithProviders } from './support/dom';

/** Builds a chat tab whose ids differ, so either can be matched independently. */
function chatTab(
	id: string,
	label: string,
): Extract<SessionTabModel, { kind?: 'chat' }> {
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
function renderStrip(
	unreadKeys: ReadonlySet<string>,
	backgroundTab: SessionTabModel = otherTab,
) {
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
			sessions={[activeTab, backgroundTab]}
			unreadKeys={unreadKeys}
		/>,
	);
}

/** Reads the accessible unread marker inside a tab, if it has one. */
function unreadMarkerIn(container: HTMLElement, tabKey: string) {
	return container
		.querySelector(`[data-tab-key="${tabKey}"]`)
		?.querySelector('[data-session-tab-unread]');
}

describe('session tab unread marker', () => {
	test('anchors the root unread dot to the top-right of its icon', () => {
		const { container } = renderStrip(new Set(['tab-other']));
		const marker = unreadMarkerIn(container, 'tab-other');
		expect(marker).toHaveClass('-top-0.5', '-right-0.5');
		expect(marker?.parentElement).toHaveClass('relative');
		expect(marker?.parentElement?.querySelector('svg')).not.toBeNull();
	});
	test.each([undefined, 1, 2] as const)(
		'never puts a dot on a sub-agent at depth %s',
		(delegationDepth) => {
			const { container } = renderStrip(new Set(['tab-other']), {
				...otherTab,
				isSubAgent: true,
				delegationDepth,
			});
			expect(unreadMarkerIn(container, 'tab-other')).toHaveClass('sr-only');
			expect(
				container.querySelector('[data-tab-key="tab-other"] .rounded-full'),
			).toBeNull();
		},
	);

	test('never puts a root dot on a non-chat tab', () => {
		const { container } = renderStrip(new Set(['tab-other']), {
			...otherTab,
			kind: 'file',
			filePath: 'src/main.ts',
		});
		expect(
			container.querySelector('[data-tab-key="tab-other"] .rounded-full'),
		).toBeNull();
	});

	test('marks an inactive tab matched by its tab id', () => {
		const { container } = renderStrip(new Set(['tab-other']));
		expect(unreadMarkerIn(container, 'tab-other')).not.toBeNull();
	});

	test('marks an inactive tab matched by its session id alone', () => {
		const { container } = renderStrip(new Set(['session-tab-other']));
		expect(unreadMarkerIn(container, 'tab-other')).not.toBeNull();
	});

	test('never marks the active tab', () => {
		const { container } = renderStrip(
			new Set(['tab-active', 'session-tab-active']),
		);
		expect(unreadMarkerIn(container, 'tab-active')).toBeNull();
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
