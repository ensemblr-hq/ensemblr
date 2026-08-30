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
	);

	assert.deepEqual(bounds, {
		height: 700,
		width: 1000,
		x: 1880,
		y: 50,
	});
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

test('only a Wayland session forbids the app placing its own window', () => {
	assert.equal(forbidsWindowPositioning('linux', 'wayland'), true);
	assert.equal(forbidsWindowPositioning('linux', 'Wayland'), true);
	assert.equal(forbidsWindowPositioning('linux', 'x11'), false);
	assert.equal(forbidsWindowPositioning('linux', undefined), false);
	assert.equal(forbidsWindowPositioning('darwin', 'wayland'), false);
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

	assert.deepEqual(store.load([primaryDisplay]), state);
});
