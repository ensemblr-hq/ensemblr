/// <reference types="bun" />

import { describe, expect, test } from 'bun:test';
import {
	type AgentActivityMonitorOptions,
	type BatterySnapshot,
	createAgentActivityMonitor,
} from '../../src/main/pi-agent/agent-activity-monitor';
import {
	type AppSettings,
	DEFAULT_APP_SETTINGS,
} from '../../src/shared/config/app-settings';
import type { PiSessionEventWire } from '../../src/shared/ipc/contracts/pi-session';

/** Lets the deferred async battery sample resolve before assertions. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function settings(general: Partial<AppSettings['general']>): AppSettings {
	return {
		general: { ...DEFAULT_APP_SETTINGS.general, ...general },
		models: DEFAULT_APP_SETTINGS.models,
	};
}

function statusEvent(status: string): PiSessionEventWire {
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

interface Harness {
	monitor: ReturnType<typeof createAgentActivityMonitor>;
	starts: number;
	stops: number;
	notifications: number;
}

function makeMonitor(
	overrides: Partial<AgentActivityMonitorOptions> & {
		readSettings: () => AppSettings;
	},
): Harness {
	const counters = { notifications: 0, starts: 0, stops: 0 };
	const monitor = createAgentActivityMonitor({
		isAppFocused: () => false,
		notify: () => {
			counters.notifications += 1;
		},
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
		h.monitor.handle({ event: statusEvent('streaming'), sessionId: 's1' });
		await flush(); // first battery sample resolves, then the blocker engages
		expect(h.starts).toBe(1);
		expect(h.stops).toBe(0);
		h.monitor.handle({ event: statusEvent('idle'), sessionId: 's1' });
		expect(h.stops).toBe(1);
	});

	test('does not engage when the setting is off', async () => {
		const h = makeMonitor({
			readSettings: () => settings({ caffeinateWhileRunning: false }),
		});
		h.monitor.handle({ event: statusEvent('streaming'), sessionId: 's1' });
		await flush();
		expect(h.starts).toBe(0);
	});

	test('holds while any of several sessions is still streaming', async () => {
		const h = makeMonitor({
			readSettings: () => settings({ caffeinateWhileRunning: true }),
		});
		h.monitor.handle({ event: statusEvent('streaming'), sessionId: 's1' });
		await flush();
		h.monitor.handle({ event: statusEvent('streaming'), sessionId: 's2' });
		expect(h.starts).toBe(1); // single blocker for both
		h.monitor.handle({ event: statusEvent('idle'), sessionId: 's1' });
		expect(h.stops).toBe(0); // s2 still running
		h.monitor.handle({ event: statusEvent('idle'), sessionId: 's2' });
		expect(h.stops).toBe(1);
	});

	test('refuses to engage below the battery cutoff (on battery)', async () => {
		const lowBattery: BatterySnapshot = { charging: false, percent: 5 };
		const h = makeMonitor({
			readBattery: () => Promise.resolve(lowBattery),
			readSettings: () => settings({ caffeinateWhileRunning: true }),
		});
		h.monitor.handle({ event: statusEvent('streaming'), sessionId: 's1' });
		await flush();
		expect(h.starts).toBe(0);
	});

	test('engages on low battery while charging', async () => {
		const h = makeMonitor({
			readBattery: () => Promise.resolve({ charging: true, percent: 5 }),
			readSettings: () => settings({ caffeinateWhileRunning: true }),
		});
		h.monitor.handle({ event: statusEvent('streaming'), sessionId: 's1' });
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
		h.monitor.handle({ event: statusEvent('streaming'), sessionId: 's1' });
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
		h.monitor.handle({ event: statusEvent('streaming'), sessionId: 's1' });
		await flush();
		h.monitor.dispose();
		expect(h.stops).toBe(1);
	});
});

describe('createAgentActivityMonitor — notifications', () => {
	test('notifies when a turn finishes (setting on, app unfocused)', () => {
		const h = makeMonitor({
			isAppFocused: () => false,
			readSettings: () => settings({ desktopNotifications: true }),
		});
		h.monitor.handle({ event: statusEvent('streaming'), sessionId: 's1' });
		h.monitor.handle({ event: statusEvent('idle'), sessionId: 's1' });
		expect(h.notifications).toBe(1);
	});

	test('stays quiet when the app is focused', () => {
		const h = makeMonitor({
			isAppFocused: () => true,
			readSettings: () => settings({ desktopNotifications: true }),
		});
		h.monitor.handle({ event: statusEvent('streaming'), sessionId: 's1' });
		h.monitor.handle({ event: statusEvent('idle'), sessionId: 's1' });
		expect(h.notifications).toBe(0);
	});

	test('stays quiet when notifications are disabled', () => {
		const h = makeMonitor({
			isAppFocused: () => false,
			readSettings: () => settings({ desktopNotifications: false }),
		});
		h.monitor.handle({ event: statusEvent('streaming'), sessionId: 's1' });
		h.monitor.handle({ event: statusEvent('idle'), sessionId: 's1' });
		expect(h.notifications).toBe(0);
	});

	test('does not notify on a never-streaming idle blip', () => {
		const h = makeMonitor({
			isAppFocused: () => false,
			readSettings: () => settings({ desktopNotifications: true }),
		});
		h.monitor.handle({ event: statusEvent('idle'), sessionId: 's1' });
		expect(h.notifications).toBe(0);
	});
});
