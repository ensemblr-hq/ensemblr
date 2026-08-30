import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	clampMainWindowBounds,
	createMainWindowStateStore,
	forbidsWindowPositioning,
	MAIN_WINDOW_MIN_HEIGHT,
	MAIN_WINDOW_MIN_WIDTH,
	normalizeMainWindowState,
} from '../../src/main/app/window-state.ts';
import {
	type EnsemblrDatabaseService,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';

const primaryDisplay = {
	workArea: {
		height: 900,
		width: 1440,
		x: 0,
		y: 0,
	},
};

function createDatabaseService(t: TestContext): EnsemblrDatabaseService {
	const connection = openEnsemblrDatabase({ databasePath: ':memory:' });
	const health = {
		path: connection.path,
		schemaVersion: connection.schemaVersion,
		status: 'ok' as const,
	};
	let closed = false;

	function close(): void {
		if (closed) {
			return;
		}

		connection.database.close();
		closed = true;
	}

	t.after(close);

	return {
		close,
		getConnection: () => (closed ? null : connection),
		getHealth: () => health,
		open: () => health,
	};
}

test('clamps restored bounds onto a visible display', () => {
	const bounds = clampMainWindowBounds(
		{
			height: 820,
			width: 1280,
			x: 5000,
			y: 1200,
		},
		[primaryDisplay],
		false,
	);

	assert.deepEqual(bounds, {
		height: 820,
		width: 1280,
		x: 160,
		y: 80,
	});
});

test('uses the display nearest to fully off-screen saved bounds', () => {
	const bounds = clampMainWindowBounds(
		{
			height: 700,
			width: 1000,
			x: 2600,
			y: 50,
		},
		[
			primaryDisplay,
			{
				workArea: {
					height: 900,
					width: 1440,
					x: 1440,
					y: 0,
				},
			},
		],
		false,
	);

	assert.deepEqual(bounds, {
		height: 700,
		width: 1000,
		x: 1880,
		y: 50,
	});
});

// On Wayland `getNormalBounds()` reports (0, 0) whichever display the window is
// on, so scoring work areas by position picks the primary and clamps a window
// off a larger secondary down to it — a little further on every launch.
test('a position-less restore clamps against the roomiest display, not the origin', () => {
	const displays = [
		{ workArea: { height: 1080, width: 1920, x: 0, y: 0 } },
		{ workArea: { height: 1440, width: 2560, x: 1920, y: 0 } },
	];
	const persisted = { height: 1400, width: 2560, x: 0, y: 0 };

	const restored = clampMainWindowBounds(persisted, displays, true);

	assert.deepEqual(restored, { height: 1400, width: 2560, x: 0, y: 0 });
	assert.deepEqual(
		clampMainWindowBounds(restored, displays, true),
		restored,
		'a second launch must not shrink the window again',
	);
});

test('a position-less restore still enforces the minimum window size', () => {
	assert.deepEqual(
		normalizeMainWindowState(
			{
				bounds: { height: 100, width: 200, x: 0, y: 0 },
				isFullScreen: false,
				isMaximized: false,
			},
			[primaryDisplay],
			true,
		),
		{
			bounds: {
				height: MAIN_WINDOW_MIN_HEIGHT,
				width: MAIN_WINDOW_MIN_WIDTH,
				x: 0,
				y: 0,
			},
			isFullScreen: false,
			isMaximized: false,
		},
	);
});

test('enforces the existing minimum window size while normalizing state', () => {
	const state = normalizeMainWindowState(
		{
			bounds: {
				height: 100,
				width: 200,
				x: 20,
				y: 30,
			},
			isFullScreen: true,
			isMaximized: true,
		},
		[primaryDisplay],
		false,
	);

	assert.deepEqual(state, {
		bounds: {
			height: MAIN_WINDOW_MIN_HEIGHT,
			width: MAIN_WINDOW_MIN_WIDTH,
			x: 20,
			y: 30,
		},
		isFullScreen: true,
		isMaximized: true,
	});
});

// A 1280x800 panel at 150% fractional scaling reports an 853x533 logical
// viewport. The floor has to sit under that, or the window cannot fit its own
// minimum and the compositor sizes it off-screen.
test('the minimum window size fits a fractionally-scaled 1280x800 panel', () => {
	assert.ok(MAIN_WINDOW_MIN_WIDTH <= 853);
	assert.ok(MAIN_WINDOW_MIN_HEIGHT <= 533);
});

test('only a Wayland client forbids the app placing its own window', () => {
	assert.equal(
		forbidsWindowPositioning({ platform: 'linux', sessionType: 'wayland' }),
		true,
	);
	assert.equal(
		forbidsWindowPositioning({ platform: 'linux', sessionType: 'Wayland' }),
		true,
	);
	assert.equal(
		forbidsWindowPositioning({ platform: 'linux', sessionType: 'x11' }),
		false,
	);
	assert.equal(
		forbidsWindowPositioning({ platform: 'linux', sessionType: undefined }),
		false,
	);
	assert.equal(
		forbidsWindowPositioning({ platform: 'darwin', sessionType: 'wayland' }),
		false,
	);
});

// `--ozone-platform=x11` is the ADR's documented escape hatch: that client can
// position itself even though logind still advertises a Wayland session.
test('the Ozone switch outranks the session logind advertises', () => {
	assert.equal(
		forbidsWindowPositioning({
			ozonePlatform: 'x11',
			platform: 'linux',
			sessionType: 'wayland',
			waylandDisplay: 'wayland-0',
		}),
		false,
	);
	assert.equal(
		forbidsWindowPositioning({
			ozonePlatform: 'wayland',
			platform: 'linux',
			sessionType: 'x11',
		}),
		true,
	);
});

// A compositor started from a TTY (`exec sway`) may leave XDG_SESSION_TYPE
// unset while still exporting WAYLAND_DISPLAY.
test('a Wayland display with no session type still forbids positioning', () => {
	assert.equal(
		forbidsWindowPositioning({
			platform: 'linux',
			sessionType: undefined,
			waylandDisplay: 'wayland-0',
		}),
		true,
	);
	assert.equal(
		forbidsWindowPositioning({
			platform: 'linux',
			sessionType: undefined,
			waylandDisplay: '',
		}),
		false,
	);
});

test('rejects invalid stored window state', () => {
	assert.equal(
		normalizeMainWindowState(
			{
				bounds: {
					height: 820,
					width: Number.NaN,
					x: 0,
					y: 0,
				},
				isFullScreen: false,
				isMaximized: false,
			},
			[primaryDisplay],
		),
		null,
	);
});

test('saves and loads main window state from app sqlite settings', (t) => {
	const store = createMainWindowStateStore({
		databaseService: createDatabaseService(t),
		now: () => new Date('2026-06-06T00:00:00.000Z'),
	});
	const state = {
		bounds: {
			height: 760,
			width: 1200,
			x: 24,
			y: 32,
		},
		isFullScreen: false,
		isMaximized: true,
	};

	store.save(state);

	assert.deepEqual(store.load([primaryDisplay], false), state);
});

test('a position-less load drops the persisted origin', (t) => {
	const store = createMainWindowStateStore({
		databaseService: createDatabaseService(t),
		now: () => new Date('2026-06-06T00:00:00.000Z'),
	});

	store.save({
		bounds: { height: 760, width: 1200, x: 24, y: 32 },
		isFullScreen: false,
		isMaximized: true,
	});

	assert.deepEqual(store.load([primaryDisplay], true), {
		bounds: { height: 760, width: 1200, x: 0, y: 0 },
		isFullScreen: false,
		isMaximized: true,
	});
});
