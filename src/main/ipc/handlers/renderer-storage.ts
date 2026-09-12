import type { DatabaseSync } from 'node:sqlite';
import { ipcMain, type WebContents } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	RendererStorageMirrorResult,
	RendererStorageSnapshot,
} from '../../../shared/ipc/contracts/renderer-storage';
import type { EnsemblrDatabaseService } from '../../storage';
import {
	hasSeededOrigin,
	markRendererStorageSeeded,
	readRendererStorageMirror,
	writeRendererStorageMirror,
} from '../../storage/repositories';
import {
	MAX_RENDERER_STORAGE_MIRROR_BYTES,
	rendererStorageSnapshotSchema,
} from '../request-schemas';

/**
 * Registers the two channels behind the renderer's `localStorage` mirror: the
 * synchronous seed the preload bootstrap reads before any page script runs, and
 * the asynchronous write the renderer pushes whenever its storage changes.
 *
 * The pair is what lets the packaged renderer's origin move without taking the
 * user's preferences with it — see
 * `docs/adr/0071-mirror-renderer-local-storage-into-sqlite.md`.
 * @param input - The database service holding the mirror.
 */
export function registerRendererStorageHandlers({
	databaseService,
}: {
	databaseService: EnsemblrDatabaseService;
}): void {
	const handedOutSeeds = new Map<number, Record<string, string>>();

	ipcMain.on(IPC_CHANNELS.rendererStorageSeed, (event) => {
		const origin = storageOriginOf(event.sender);
		const seed = origin ? readSeed(databaseService, origin) : null;
		if (seed) {
			handedOutSeeds.set(event.sender.id, seed);
		}
		const snapshot: RendererStorageSnapshot | null = seed
			? { entries: seed }
			: null;
		event.returnValue = snapshot;
	});

	ipcMain.handle(
		IPC_CHANNELS.mirrorRendererStorage,
		(event, raw: unknown): RendererStorageMirrorResult => {
			const checked = checkSnapshot(raw);
			if ('refusal' in checked) {
				return refuse(checked.refusal, 'refused a mirror write');
			}
			const entries = checked.entries;

			const origin = storageOriginOf(event.sender);
			if (!origin) {
				return refuse('unknown-origin', 'could not attribute a mirror write');
			}

			const database = databaseService.getConnection()?.database ?? null;
			if (!database) {
				return { reason: 'database-unavailable', status: 'skipped' };
			}

			const seed = handedOutSeeds.get(event.sender.id);
			const refusal = refuseReplacingMirror({ database, entries, seed });
			if (refusal) {
				return refusal;
			}

			writeRendererStorageMirror({ database, entries, origin });

			if (seed) {
				markRendererStorageSeeded({
					database,
					origin,
					seededAt: new Date().toISOString(),
				});
				handedOutSeeds.delete(event.sender.id);
			}

			return { status: 'stored' };
		},
	);
}

/**
 * Admits a payload that is both well-formed and small enough to replay into a
 * target origin later, or names which of the two it failed.
 * @param raw - The payload the renderer sent.
 * @returns The entries to store, or the reason they cannot be.
 */
function checkSnapshot(
	raw: unknown,
):
	| { entries: Record<string, string> }
	| { refusal: 'malformed' | 'too-large' } {
	const parsed = rendererStorageSnapshotSchema.safeParse(raw);
	if (!parsed.success) {
		return { refusal: 'malformed' };
	}

	const entries = parsed.data.entries;
	if (JSON.stringify(entries).length > MAX_RENDERER_STORAGE_MIRROR_BYTES) {
		return { refusal: 'too-large' };
	}

	return { entries };
}

/**
 * Why a well-formed snapshot must not replace the stored mirror, if it must
 * not. Both cases protect the copy rather than report a fault: it may be the
 * only copy of the user's preferences left.
 * @param input - Open connection, the snapshot, and the seed this renderer was handed.
 * @returns The refusal to answer with, or null when the snapshot may be stored.
 */
function refuseReplacingMirror({
	database,
	entries,
	seed,
}: {
	database: DatabaseSync;
	entries: Record<string, string>;
	seed: Record<string, string> | undefined;
}): RendererStorageMirrorResult | null {
	if (seed && !carriesSeed(entries, seed)) {
		return refuse(
			'seed-not-applied',
			'kept the mirror: the seed handed to this renderer did not reach its storage',
		);
	}

	if (Object.keys(entries).length > 0) {
		return null;
	}

	return Object.keys(readRendererStorageMirror(database).entries).length > 0
		? refuse(
				'empty-snapshot',
				'kept the mirror: an empty renderer storage would have replaced it',
			)
		: null;
}

/**
 * Logs why a snapshot was not stored and answers the renderer with the reason.
 * @param reason - The machine-readable reason for the renderer.
 * @param because - The human-readable half of the log line.
 * @returns The skipped envelope to return from the handler.
 */
function refuse(
	reason: Extract<RendererStorageMirrorResult, { status: 'skipped' }>['reason'],
	because: string,
): RendererStorageMirrorResult {
	console.warn(`[renderer-storage] ${because} (${reason})`);
	return { reason, status: 'skipped' };
}

/**
 * The storage origin of the document a web contents is showing, in the
 * `scheme://host` shape web storage is partitioned by.
 *
 * Built from the URL's protocol and host rather than read off `URL.origin`,
 * which reports `null` for both `file:` and any non-special scheme — so the
 * packaged `file:` renderer and a future `app://bundle` would be
 * indistinguishable exactly where the distinction matters.
 * @param sender - The web contents that sent the message.
 * @returns The origin key, or null when the URL cannot be read.
 */
function storageOriginOf(sender: WebContents): string | null {
	try {
		const url = sender.getURL();
		if (!url) {
			return null;
		}
		const parsed = new URL(url);
		return `${parsed.protocol}//${parsed.host}`;
	} catch {
		return null;
	}
}

/**
 * Reads the mirror the preload bootstrap should replay into an empty renderer
 * storage. The marker is deliberately *not* set here: it is set once the
 * renderer's own snapshot proves the seed arrived, so a seed that never lands
 * is retried on the next launch instead of being written off.
 * @param databaseService - The database service holding the mirror.
 * @param origin - Origin of the document asking for the seed.
 * @returns The entries to replay, or null when there are none to offer this origin.
 */
function readSeed(
	databaseService: EnsemblrDatabaseService,
	origin: string,
): Record<string, string> | null {
	const database = databaseService.getConnection()?.database ?? null;
	if (!database) {
		return null;
	}

	try {
		if (hasSeededOrigin(database, origin)) {
			return null;
		}
		const mirror = readRendererStorageMirror(database);
		if (Object.keys(mirror.entries).length === 0) {
			return null;
		}
		// An origin is never seeded from a snapshot it took itself: its storage
		// being empty means the user cleared it, not that the renderer moved.
		if (mirror.origin === origin) {
			return null;
		}
		return mirror.entries;
	} catch (error) {
		console.warn('[renderer-storage] could not read the mirror', error);
		return null;
	}
}

/**
 * Whether a renderer snapshot still holds every key of the seed it was handed.
 *
 * Presence rather than value equality: a renderer that boots and immediately
 * rewrites a seeded preference has still received its seed, and demanding the
 * values match would refuse its snapshot for the rest of the session.
 * @param entries - The snapshot the renderer just mirrored.
 * @param seed - The entries main handed the preload bootstrap this launch.
 * @returns True when every seeded key is present.
 */
function carriesSeed(
	entries: Record<string, string>,
	seed: Record<string, string>,
): boolean {
	return Object.keys(seed).every((key) => Object.hasOwn(entries, key));
}
