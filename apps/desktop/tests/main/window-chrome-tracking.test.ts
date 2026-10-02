import type { BrowserWindow } from 'electron';
import { expect, test } from 'vitest';

import { trackWindowChrome } from '../../src/main/app/window-chrome';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels';
import type { WindowChromeSnapshot } from '../../src/shared/window-chrome';

/** A window event the tracker subscribes to. */
type TrackedEvent = 'enter-full-screen' | 'leave-full-screen';

/** What a fake window recorded, and the handles a test drives it with. */
interface FakeWindow {
	emit: (event: TrackedEvent) => void;
	finishLoad: () => void;
	sent: { channel: string; payload: WindowChromeSnapshot }[];
	setDestroyed: (destroyed: boolean) => void;
	setFullScreen: (fullScreen: boolean) => void;
	window: BrowserWindow;
}

/**
 * Builds the smallest window the tracker actually uses: two lifecycle events, a
 * full-screen reading, the destroyed guards, and a recording `send`.
 * @returns The fake window and the handles to drive it.
 */
function createFakeWindow(): FakeWindow {
	const handlers = new Map<string, (() => void)[]>();
	const contentsHandlers = new Map<string, (() => void)[]>();
	const sent: { channel: string; payload: WindowChromeSnapshot }[] = [];
	let destroyed = false;
	let fullScreen = false;

	const listen =
		(target: Map<string, (() => void)[]>) =>
		(event: string, handler: () => void) => {
			target.set(event, [...(target.get(event) ?? []), handler]);
		};

	const window = {
		isDestroyed: () => destroyed,
		isFullScreen: () => fullScreen,
		on: listen(handlers),
		webContents: {
			isDestroyed: () => destroyed,
			on: listen(contentsHandlers),
			send: (channel: string, payload: WindowChromeSnapshot) => {
				sent.push({ channel, payload });
			},
		},
	} as unknown as BrowserWindow;

	const fire = (target: Map<string, (() => void)[]>, event: string): void => {
		for (const handler of target.get(event) ?? []) {
			handler();
		}
	};

	return {
		emit: (event) => fire(handlers, event),
		finishLoad: () => fire(contentsHandlers, 'did-finish-load'),
		sent,
		setDestroyed: (next) => {
			destroyed = next;
		},
		setFullScreen: (next) => {
			fullScreen = next;
		},
		window,
	};
}

test('entering full screen pushes a snapshot that says so', () => {
	const fake = createFakeWindow();
	trackWindowChrome({
		onResolved: () => {},
		titleBar: 'system',
		window: fake.window,
	});

	fake.setFullScreen(true);
	fake.emit('enter-full-screen');

	expect(fake.sent).toHaveLength(1);
	expect(fake.sent[0]?.channel).toBe(IPC_CHANNELS.windowChromeChanged);
	expect(fake.sent[0]?.payload.fullScreen).toBe(true);
});

test('leaving full screen pushes a snapshot that says so', () => {
	const fake = createFakeWindow();
	trackWindowChrome({
		onResolved: () => {},
		titleBar: 'system',
		window: fake.window,
	});

	fake.setFullScreen(true);
	fake.emit('enter-full-screen');
	fake.setFullScreen(false);
	fake.emit('leave-full-screen');

	expect(fake.sent.at(-1)?.payload.fullScreen).toBe(false);
});

test('the caller records the same snapshot the renderer is sent', () => {
	const fake = createFakeWindow();
	const recorded: WindowChromeSnapshot[] = [];
	trackWindowChrome({
		onResolved: (chrome) => recorded.push(chrome),
		titleBar: 'system',
		window: fake.window,
	});

	fake.setFullScreen(true);
	fake.emit('enter-full-screen');

	expect(recorded).toHaveLength(1);
	expect(recorded[0]).toBe(fake.sent[0]?.payload);
});

test('a window restored into full screen republishes on first load', () => {
	const fake = createFakeWindow();
	trackWindowChrome({
		onResolved: () => {},
		titleBar: 'system',
		window: fake.window,
	});

	fake.setFullScreen(true);
	fake.finishLoad();

	expect(fake.sent.at(-1)?.payload.fullScreen).toBe(true);
});

test('a torn-down window is never sent to', () => {
	const fake = createFakeWindow();
	trackWindowChrome({
		onResolved: () => {},
		titleBar: 'system',
		window: fake.window,
	});

	fake.setDestroyed(true);
	fake.emit('enter-full-screen');

	expect(fake.sent).toHaveLength(0);
});
