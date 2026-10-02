import { beforeEach, expect, test, vi } from 'vitest';

const { shown } = vi.hoisted(() => ({
	shown: [] as { events: string[]; steps: string[] }[],
}));

vi.mock('electron', () => {
	/** Stand-in for Electron's `Notification` that records how it was wired. */
	class FakeNotification {
		private readonly record = { events: [] as string[], steps: [] as string[] };

		static isSupported(): boolean {
			return true;
		}

		constructor() {
			shown.push(this.record);
		}

		on(event: string): this {
			this.record.events.push(event);
			this.record.steps.push('on');
			return this;
		}

		show(): void {
			this.record.steps.push('show');
		}
	}

	return {
		app: { focus: vi.fn() },
		BrowserWindow: { getAllWindows: () => [] },
		Notification: FakeNotification,
		powerSaveBlocker: { start: () => 0, stop: () => undefined },
	};
});

import type { AgentNotification } from '../../src/main/agent-runtime/agent-activity-monitor.ts';
import { electronNotify } from '../../src/main/agent-runtime/electron-activity-bindings.ts';

const notification: AgentNotification = {
	body: 'Finished the refactor',
	playSound: false,
	target: {
		agentSessionId: 'session-7',
		chatTabId: 'tab-7',
		kind: 'chat',
		workspaceId: 'workspace-7',
	},
	title: 'Review: retention',
};

beforeEach(() => {
	shown.length = 0;
});

test('hands every shown notification to the retainer', () => {
	electronNotify(notification);

	expect(shown).toHaveLength(1);
	expect(shown[0].events).toEqual(['click', 'click', 'close', 'failed']);
});

test('retains before handing the banner to macOS', () => {
	electronNotify(notification);

	expect(shown[0].steps.at(-1)).toBe('show');
});
