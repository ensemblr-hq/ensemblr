import { app, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	CompactDatabaseResult,
	HealthSnapshot,
} from '../../../shared/ipc/contracts/health';
import type { EnsemblrConfigService } from '../../config';
import type { EnsemblrDatabaseService } from '../../storage';

/**
 * Registers the async health-snapshot and database-compaction IPC handlers.
 * The synchronous initial-shell snapshot lives in `handlers/shell-snapshot.ts`
 * so this file stays scoped to health and its one maintenance action.
 * @param options - Required services.
 */
export function registerHealthHandlers({
	configService,
	databaseService,
}: {
	configService: EnsemblrConfigService;
	databaseService: EnsemblrDatabaseService;
}): void {
	ipcMain.handle(IPC_CHANNELS.health, (): HealthSnapshot => {
		return buildHealthSnapshot(configService, databaseService);
	});

	ipcMain.handle(IPC_CHANNELS.compactDatabase, (): CompactDatabaseResult => {
		return compactDatabase(databaseService);
	});
}

/**
 * Runs `VACUUM` against the local database, reporting the size before and
 * after and how long the (blocking) rewrite took.
 * @param databaseService - Database service whose file to compact.
 * @returns The before/after size and duration.
 */
function compactDatabase(
	databaseService: EnsemblrDatabaseService,
): CompactDatabaseResult {
	const sizeBytesBefore = databaseService.getHealth().sizeBytes ?? null;
	const startedAt = Date.now();
	databaseService.vacuum();

	return {
		durationMs: Date.now() - startedAt,
		sizeBytesAfter: databaseService.getHealth().sizeBytes ?? null,
		sizeBytesBefore,
	};
}

/** Single source of truth for the health-snapshot shape. */
export function buildHealthSnapshot(
	configService: EnsemblrConfigService,
	databaseService: EnsemblrDatabaseService,
): HealthSnapshot {
	return {
		appName: app.getName(),
		config: configService.getSnapshot(),
		database: databaseService.getHealth(),
		platform: process.platform,
		status: 'ok',
		timestamp: new Date().toISOString(),
		versions: {
			chrome: process.versions.chrome,
			electron: process.versions.electron,
			node: process.versions.node,
		},
	};
}
