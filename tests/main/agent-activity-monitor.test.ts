import { describe, expect, test } from 'vitest';
import {
	type AgentActivityMonitorOptions,
	type AgentNotification,
	type BatterySnapshot,
	createAgentActivityMonitor,
} from '../../src/main/agent-runtime/agent-activity-monitor';
import type { NotificationTarget } from '../../src/main/agent-runtime/notification-target';
import {
	type AppSettings,
	DEFAULT_APP_SETTINGS,
} from '../../src/shared/config';
import type { AgentSessionEventWire } from '../../src/shared/ipc/contracts/agent-session';

/** Lets the deferred async battery sample resolve before assertions. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function settings(general: Partial<AppSettings['general']>): AppSettings {
	return {
		...DEFAULT_APP_SETTINGS,
		general: { ...DEFAULT_APP_SETTINGS.general, ...general },
	};
}

function statusEvent(status: string): AgentSessionEventWire {
	return {
		branchId: 'b1',
		createdAt: '2026-01-01T00:00:00.000Z',
		eventType: 'status',
		id: `evt-${status}`,
		ordinal: 1,
		// previous is unused by the monitor; cast keeps the fixture terse.
		payload: { kind: 'status', previous: 'idle', status } as never,
		stream: 'protocol',
		turnId: 't1',
	};
}

/** The chat every notification test resolves to unless it overrides the port. */
const TARGET: NotificationTarget = {
	chatTabId: 'tab-1',
	isSubAgent: false,
	tabTitle: 'Fix the notifier',
	workspaceId: 'w1',
	workspaceName: 'vangelis',
};

function statusFor(status: string, sessionId: string, workspaceId = 'w1') {
	return { event: statusEvent(status), sessionId, workspaceId };
}

interface Harness {
	monitor: ReturnType<typeof createAgentActivityMonitor>;
	starts: number;
	stops: number;
	notifications: AgentNotification[];
}

function makeMonitor(
	overrides: Partial<AgentActivityMonitorOptions> & {
		readSettings: () => AppSettings;
	},
): Harness {
	const counters = {
		notifications: [] as AgentNotification[],
		starts: 0,
		stops: 0,
	};
	const monitor = createAgentActivityMonitor({
		isAppFocused: () => false,
		notify: (notification) => {
			counters.notifications.push(notification);
		},
		resolveTarget: () => TARGET,
		// Run the battery poll synchronously-cancellable but never auto-fire.
		scheduleInterval: () => () => undefined,
		powerControls: {
			start: () => {
				counters.starts += 1;
				return counters.starts;
			},
			stop: () => {
				counters.stops += 1;
			},
		},
		...overrides,
	});
	return {
		monitor,
		get notifications() {
			return counters.notifications;
		},
		get starts() {
			return counters.starts;
		},
		get stops() {
			return counters.stops;
		},
	};
}

describe('createAgentActivityMonitor — caffeinate', () => {
	test('engages the blocker while streaming, releases when idle', async () => {
		const h = makeMonitor({
			readSettings: () => settings({ caffeinateWhileRunning: true }),
		});
		h.monitor.handle(statusFor('streaming', 's1'));
		await flush(); // first battery sample resolves, then the blocker engages
		expect(h.starts).toBe(1);
		expect(h.stops).toBe(0);
		h.monitor.handle(statusFor('idle', 's1'));
		expect(h.stops).toBe(1);
	});

	test('does not engage when the setting is off', async () => {
		const h = makeMonitor({
			readSettings: () => settings({ caffeinateWhileRunning: false }),
		});
		h.monitor.handle(statusFor('streaming', 's1'));
		await flush();
		expect(h.starts).toBe(0);
	});

	test('holds while any of several sessions is still streaming', async () => {
		const h = makeMonitor({
			readSettings: () => settings({ caffeinateWhileRunning: true }),
		});
		h.monitor.handle(statusFor('streaming', 's1'));
		await flush();
		h.monitor.handle(statusFor('streaming', 's2'));
		expect(h.starts).toBe(1); // single blocker for both
		h.monitor.handle(statusFor('idle', 's1'));
		expect(h.stops).toBe(0); // s2 still running
		h.monitor.handle(statusFor('idle', 's2'));
		expect(h.stops).toBe(1);
	});

	test('refuses to engage below the battery cutoff (on battery)', async () => {
		const lowBattery: BatterySnapshot = { charging: false, percent: 5 };
		const h = makeMonitor({
			readBattery: () => Promise.resolve(lowBattery),
			readSettings: () => settings({ caffeinateWhileRunning: true }),
		});
		h.monitor.handle(statusFor('streaming', 's1'));
		await flush();
		expect(h.starts).toBe(0);
	});

	test('engages on low battery while charging', async () => {
		const h = makeMonitor({
			readBattery: () => Promise.resolve({ charging: true, percent: 5 }),
			readSettings: () => settings({ caffeinateWhileRunning: true }),
		});
		h.monitor.handle(statusFor('streaming', 's1'));
		await flush();
		expect(h.starts).toBe(1);
	});

	test('releases the blocker when the battery later drains', async () => {
		let battery: BatterySnapshot = { charging: false, percent: 80 };
		// Drive the engaged-state poll by hand so we can swap the reading. Held on
		// an object so TS keeps the closure-assigned callback in its type.
		const pollRef: { fn: (() => void) | null } = { fn: null };
		const h = makeMonitor({
			readBattery: () => Promise.resolve(battery),
			scheduleInterval: (callback) => {
				pollRef.fn = callback;
				return () => {
					pollRef.fn = null;
				};
			},
			readSettings: () => settings({ caffeinateWhileRunning: true }),
		});
		h.monitor.handle(statusFor('streaming', 's1'));
		await flush();
		expect(h.starts).toBe(1);
		// Battery drains below the cutoff; the next poll re-samples and releases.
		battery = { charging: false, percent: 5 };
		pollRef.fn?.();
		await flush();
		expect(h.stops).toBe(1);
	});

	test('dispose releases an engaged blocker', async () => {
		const h = makeMonitor({
			readSettings: () => settings({ caffeinateWhileRunning: true }),
		});
		h.monitor.handle(statusFor('streaming', 's1'));
		await flush();
		h.monitor.dispose();
		expect(h.stops).toBe(1);
	});
});

describe('createAgentActivityMonitor — notifications', () => {
	/** Runs a session through a full streaming-then-idle turn. */
	function finishTurn(h: Harness, sessionId = 's1', workspaceId = 'w1'): void {
		h.monitor.handle(statusFor('streaming', sessionId, workspaceId));
		h.monitor.handle(statusFor('idle', sessionId, workspaceId));
	}

	test('notifies when a turn finishes (setting on, app unfocused)', () => {
		const h = makeMonitor({
			isAppFocused: () => false,
			readSettings: () => settings({ desktopNotifications: true }),
		});
		finishTurn(h);
		expect(h.notifications).toHaveLength(1);
	});

	test('notifies for a background chat even while the app is focused', () => {
		const h = makeMonitor({
			isAppFocused: () => true,
			isChatOnScreen: (_workspaceId, agentSessionId) =>
				agentSessionId === 'on-screen',
			readSettings: () => settings({ desktopNotifications: true }),
		});
		finishTurn(h, 'background');
		expect(h.notifications).toHaveLength(1);
	});

	test('stays quiet for the chat on screen in a focused window', () => {
		const h = makeMonitor({
			isAppFocused: () => true,
			isChatOnScreen: (_workspaceId, agentSessionId) => agentSessionId === 's1',
			readSettings: () => settings({ desktopNotifications: true }),
		});
		finishTurn(h);
		expect(h.notifications).toHaveLength(0);
	});

	test('notifies for the chat on screen when the window is not focused', () => {
		const h = makeMonitor({
			isAppFocused: () => false,
			isChatOnScreen: () => true,
			readSettings: () => settings({ desktopNotifications: true }),
		});
		finishTurn(h);
		expect(h.notifications).toHaveLength(1);
	});

	test('stays quiet when notifications are disabled', () => {
		const h = makeMonitor({
			isAppFocused: () => false,
			readSettings: () => settings({ desktopNotifications: false }),
		});
		finishTurn(h);
		expect(h.notifications).toHaveLength(0);
	});

	test('does not notify on a never-streaming idle blip', () => {
		const h = makeMonitor({
			isAppFocused: () => false,
			readSettings: () => settings({ desktopNotifications: true }),
		});
		h.monitor.handle(statusFor('idle', 's1'));
		expect(h.notifications).toHaveLength(0);
	});

	test('stays quiet for a chat hosting a sub-agent', () => {
		const h = makeMonitor({
			readSettings: () => settings({ desktopNotifications: true }),
			resolveTarget: () => ({ ...TARGET, isSubAgent: true }),
		});
		finishTurn(h);
		expect(h.notifications).toHaveLength(0);
	});

	test('stays quiet when the chat cannot be resolved', () => {
		const h = makeMonitor({
			readSettings: () => settings({ desktopNotifications: true }),
			resolveTarget: () => null,
		});
		finishTurn(h);
		expect(h.notifications).toHaveLength(0);
	});

	test('stays quiet for the idle a user-requested stop settles', () => {
		const h = makeMonitor({
			readSettings: () => settings({ desktopNotifications: true }),
		});
		h.monitor.handle(statusFor('streaming', 's1'));
		h.monitor.noteUserStop('s1');
		h.monitor.handle(statusFor('idle', 's1'));
		expect(h.notifications).toHaveLength(0);
	});

	test('a stop only silences the turn it stopped', () => {
		const h = makeMonitor({
			readSettings: () => settings({ desktopNotifications: true }),
		});
		h.monitor.handle(statusFor('streaming', 's1'));
		h.monitor.noteUserStop('s1');
		h.monitor.handle(statusFor('idle', 's1'));
		finishTurn(h);
		expect(h.notifications).toHaveLength(1);
	});

	test('names the tab in the title and the workspace in the body', () => {
		const h = makeMonitor({
			readLanguage: () => 'en',
			readSettings: () => settings({ desktopNotifications: true }),
		});
		finishTurn(h);
		expect(h.notifications[0]?.title).toBe('Fix the notifier');
		expect(h.notifications[0]?.body).toBe('Finished in vangelis');
	});

	test('carries the chat a click should open', () => {
		const h = makeMonitor({
			readSettings: () => settings({ desktopNotifications: true }),
		});
		finishTurn(h, 's7', 'w9');
		expect(h.notifications[0]?.target).toEqual({
			agentSessionId: 's7',
			chatTabId: 'tab-1',
			workspaceId: 'w9',
		});
	});

	test('falls back to a localized title when the tab is unnamed', () => {
		const h = makeMonitor({
			readLanguage: () => 'ru',
			readSettings: () => settings({ desktopNotifications: true }),
			resolveTarget: () => ({ ...TARGET, tabTitle: null }),
		});
		finishTurn(h);
		expect(h.notifications[0]?.title).toBe('Чат без названия');
		expect(h.notifications[0]?.body).toBe('Завершено в vangelis');
	});

	test('announces a questionnaire an agent is blocked on', () => {
		const h = makeMonitor({
			readLanguage: () => 'en',
			readSettings: () => settings({ desktopNotifications: true }),
		});
		h.monitor.notifyQuestionRaised({
			agentSessionId: 's1',
			workspaceId: 'w1',
		});
		expect(h.notifications[0]?.body).toBe(
			'Waiting for your answer in vangelis',
		);
	});

	test('a questionnaire respects the on-screen and sub-agent gates', () => {
		const onScreen = makeMonitor({
			isAppFocused: () => true,
			isChatOnScreen: () => true,
			readSettings: () => settings({ desktopNotifications: true }),
		});
		onScreen.monitor.notifyQuestionRaised({
			agentSessionId: 's1',
			workspaceId: 'w1',
		});
		expect(onScreen.notifications).toHaveLength(0);

		const child = makeMonitor({
			readSettings: () => settings({ desktopNotifications: true }),
			resolveTarget: () => ({ ...TARGET, isSubAgent: true }),
		});
		child.monitor.notifyQuestionRaised({
			agentSessionId: 's1',
			workspaceId: 'w1',
		});
		expect(child.notifications).toHaveLength(0);
	});
});

describe('createAgentActivityMonitor — listRunning', () => {
	test('starts empty, so a crashed prior run leaves no phantom entry', () => {
		const h = makeMonitor({ readSettings: () => settings({}) });
		expect(h.monitor.listRunning()).toEqual([]);
	});

	test('reports each streaming session with its workspace', () => {
		const h = makeMonitor({ readSettings: () => settings({}) });
		h.monitor.handle(statusFor('streaming', 's1', 'w1'));
		h.monitor.handle(statusFor('starting', 's2', 'w2'));
		expect(h.monitor.listRunning()).toEqual([
			{ sessionId: 's1', workspaceId: 'w1' },
			{ sessionId: 's2', workspaceId: 'w2' },
		]);
	});

	test('drops a session once it goes idle', () => {
		const h = makeMonitor({ readSettings: () => settings({}) });
		h.monitor.handle(statusFor('streaming', 's1', 'w1'));
		h.monitor.handle(statusFor('streaming', 's2', 'w2'));
		h.monitor.handle(statusFor('idle', 's1', 'w1'));
		expect(h.monitor.listRunning()).toEqual([
			{ sessionId: 's2', workspaceId: 'w2' },
		]);
	});

	test('drops a session on shutdown', () => {
		const h = makeMonitor({ readSettings: () => settings({}) });
		h.monitor.handle(statusFor('streaming', 's1', 'w1'));
		h.monitor.handle({
			event: {
				...statusEvent('streaming'),
				eventType: 'shutdown',
				payload: { kind: 'shutdown', reason: 'closed' } as never,
			},
			sessionId: 's1',
			workspaceId: 'w1',
		});
		expect(h.monitor.listRunning()).toEqual([]);
	});

	test('dispose clears the set', () => {
		const h = makeMonitor({ readSettings: () => settings({}) });
		h.monitor.handle(statusFor('streaming', 's1', 'w1'));
		h.monitor.dispose();
		expect(h.monitor.listRunning()).toEqual([]);
	});
});
