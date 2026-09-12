import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels.ts';
import type {
	RendererStorageMirrorResult,
	RendererStorageSnapshot,
} from '../../src/shared/ipc/contracts/renderer-storage.ts';

type SyncListener = (event: unknown) => void;
type InvokeHandler = (event: unknown, payload: unknown) => unknown;

const ipc = vi.hoisted(() => ({
	handlers: new Map<string, InvokeHandler>(),
	syncListeners: new Map<string, SyncListener>(),
}));

vi.mock('electron', () => ({
	ipcMain: {
		handle: (channel: string, handler: InvokeHandler) => {
			ipc.handlers.set(channel, handler);
		},
		on: (channel: string, listener: SyncListener) => {
			ipc.syncListeners.set(channel, listener);
		},
	},
}));

const { registerRendererStorageHandlers } = await import(
	'../../src/main/ipc/handlers/renderer-storage.ts'
);
const { openEnsemblrDatabase } = await import(
	'../../src/main/storage/database.ts'
);
const { readRendererStorageMirror, hasSeededOrigin } = await import(
	'../../src/main/storage/repositories/renderer-storage-repository.ts'
);
const { MAX_RENDERER_STORAGE_MIRROR_BYTES } = await import(
	'../../src/main/ipc/request-schemas/renderer-storage.ts'
);

const PACKAGED_URL = 'file:///Applications/Ensemblr.app/index.html';
const APP_SCHEME_URL = 'app://bundle/index.html';

let nextSenderId = 1;

/**
 * Registers the handlers as one app launch would, and returns the two calls a
 * renderer served from `url` makes against them.
 * @param database - The database the launch is wired to, or null for a closed one.
 * @param url - The document URL the renderer reports, or null for one that has none.
 */
function launch(
	database: DatabaseSync | null,
	url: string | null = PACKAGED_URL,
) {
	registerRendererStorageHandlers({
		databaseService: {
			close: () => {},
			getConnection: () =>
				database ? { database, path: ':memory:', schemaVersion: 0 } : null,
			getHealth: () => {
				throw new Error('unused');
			},
			open: () => {
				throw new Error('unused');
			},
			vacuum: () => {},
		},
	});

	const event = { sender: { getURL: () => url ?? '', id: nextSenderId++ } };

	return {
		mirror: (entries: Record<string, string>): RendererStorageMirrorResult => {
			const handler = ipc.handlers.get(IPC_CHANNELS.mirrorRendererStorage);
			return handler?.(event, { entries }) as RendererStorageMirrorResult;
		},
		mirrorRaw: (payload: unknown): RendererStorageMirrorResult => {
			const handler = ipc.handlers.get(IPC_CHANNELS.mirrorRendererStorage);
			return handler?.(event, payload) as RendererStorageMirrorResult;
		},
		seed: (): RendererStorageSnapshot | null => {
			const seedEvent = { ...event, returnValue: undefined as unknown };
			ipc.syncListeners.get(IPC_CHANNELS.rendererStorageSeed)?.(seedEvent);
			return seedEvent.returnValue as RendererStorageSnapshot | null;
		},
	};
}

describe('the renderer storage mirror', () => {
	let database: DatabaseSync;

	beforeEach(() => {
		ipc.handlers.clear();
		ipc.syncListeners.clear();
		database = openEnsemblrDatabase({ databasePath: ':memory:' }).database;
	});

	test('stores what the renderer mirrors, against the origin it came from', () => {
		const app = launch(database);

		expect(app.mirror({ ensemblr_pref_theme: '"dark"' })).toEqual({
			status: 'stored',
		});
		expect(readRendererStorageMirror(database)).toEqual({
			entries: { ensemblr_pref_theme: '"dark"' },
			origin: 'file://',
		});
	});

	test('replaces the copy wholesale, so a deleted key does not linger', () => {
		const app = launch(database);

		app.mirror({ a: '1', b: '2' });
		app.mirror({ a: '1' });

		expect(readRendererStorageMirror(database).entries).toEqual({ a: '1' });
	});

	test('offers no seed while nothing has been mirrored', () => {
		expect(launch(database).seed()).toBeNull();
	});

	test('hands the mirror to a renderer on a new origin, once', () => {
		launch(database).mirror({ ensemblr_pref_theme: '"dark"' });

		const moved = launch(database, APP_SCHEME_URL);
		expect(moved.seed()).toEqual({
			entries: { ensemblr_pref_theme: '"dark"' },
		});

		moved.mirror({ ensemblr_pref_theme: '"dark"' });

		expect(hasSeededOrigin(database, 'app://bundle')).toBe(true);
		expect(launch(database, APP_SCHEME_URL).seed()).toBeNull();
	});

	// The marker is per origin rather than per install: a second move would
	// otherwise find the one marker already spent and orphan the preferences all
	// over again.
	test('still has a seed for the next origin after one has been seeded', () => {
		launch(database).mirror({ ensemblr_pref_theme: '"dark"' });

		const moved = launch(database, APP_SCHEME_URL);
		moved.seed();
		moved.mirror({ ensemblr_pref_theme: '"dark"' });

		expect(launch(database, 'app://v2/index.html').seed()).toEqual({
			entries: { ensemblr_pref_theme: '"dark"' },
		});
	});

	// An origin is never restored from a snapshot it took itself. Its storage
	// being empty means the user cleared it, not that the renderer moved.
	test('does not hand an origin back its own snapshot', () => {
		launch(database).mirror({ ensemblr_pref_theme: '"dark"' });

		expect(launch(database).seed()).toBeNull();
	});

	test('keeps the seed on offer until a renderer proves it arrived', () => {
		launch(database).mirror({ ensemblr_pref_theme: '"dark"' });

		const failed = launch(database, APP_SCHEME_URL);
		failed.seed();

		expect(failed.mirror({})).toEqual({
			reason: 'seed-not-applied',
			status: 'skipped',
		});
		expect(readRendererStorageMirror(database).entries).toEqual({
			ensemblr_pref_theme: '"dark"',
		});
		expect(launch(database, APP_SCHEME_URL).seed()).toEqual({
			entries: { ensemblr_pref_theme: '"dark"' },
		});
	});

	// Presence, not equality: a renderer that boots and immediately rewrites a
	// seeded preference has still received its seed.
	test('accepts a snapshot that changed a seeded value', () => {
		launch(database).mirror({ ensemblr_pref_theme: '"dark"' });

		const moved = launch(database, APP_SCHEME_URL);
		moved.seed();

		expect(moved.mirror({ ensemblr_pref_theme: '"light"' })).toEqual({
			status: 'stored',
		});
		expect(readRendererStorageMirror(database).entries).toEqual({
			ensemblr_pref_theme: '"light"',
		});
	});

	test('keeps a populated mirror rather than let an empty storage clear it', () => {
		launch(database).mirror({ ensemblr_pref_theme: '"dark"' });

		const app = launch(database);

		expect(app.mirror({})).toEqual({
			reason: 'empty-snapshot',
			status: 'skipped',
		});
		expect(readRendererStorageMirror(database).entries).toEqual({
			ensemblr_pref_theme: '"dark"',
		});
	});

	test('refuses a malformed payload', () => {
		const app = launch(database);

		expect(app.mirrorRaw({ entries: { a: 7 } })).toEqual({
			reason: 'malformed',
			status: 'skipped',
		});
		expect(app.mirrorRaw(undefined)).toEqual({
			reason: 'malformed',
			status: 'skipped',
		});
	});

	test('refuses a payload larger than an origin could hold', () => {
		const app = launch(database);
		const oversized = 'x'.repeat(MAX_RENDERER_STORAGE_MIRROR_BYTES + 1);

		expect(app.mirror({ bulk: oversized })).toEqual({
			reason: 'too-large',
			status: 'skipped',
		});
		expect(readRendererStorageMirror(database).entries).toEqual({});
	});

	test('refuses a snapshot it cannot attribute to an origin', () => {
		const app = launch(database, null);

		expect(app.seed()).toBeNull();
		expect(app.mirror({ a: '1' })).toEqual({
			reason: 'unknown-origin',
			status: 'skipped',
		});
	});

	test('says so rather than throwing when the database is closed', () => {
		const app = launch(null);

		expect(app.seed()).toBeNull();
		expect(app.mirror({ a: '1' })).toEqual({
			reason: 'database-unavailable',
			status: 'skipped',
		});
	});
});
