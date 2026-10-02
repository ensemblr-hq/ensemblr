/** Validation status of the app config file. */
export type ConfigStatus = 'error' | 'invalid' | 'missing' | 'ok';
/** Severity level for a config diagnostic. */
export type ConfigDiagnosticSeverity = 'error' | 'info' | 'warning';

/** A diagnostic about the app config file, optionally located at a line/column or field path. */
export interface ConfigDiagnostic {
	code: string;
	column?: number;
	fieldPath?: string;
	line?: number;
	message: string;
	severity: ConfigDiagnosticSeverity;
}

/** Snapshot of the app config's validation state, diagnostics, and load metadata. */
export interface ConfigStatusSnapshot {
	blocksReadiness: boolean;
	diagnostics: ConfigDiagnostic[];
	displayPath: string;
	loadedAt: string;
	path: string;
	schemaVersion: number | null;
	status: ConfigStatus;
}

/**
 * Broadcast from main to renderer when `config.json` is reloaded after an
 * external edit. Carries the fresh status snapshot; consumers re-resolve
 * settings that derive from the non-App config sections.
 */
export interface ConfigChangedBroadcast {
	snapshot: ConfigStatusSnapshot;
}

/** Health status of the local database. */
export type DatabaseStatus = 'ok' | 'error';

/**
 * Snapshot of the local database's health, path, and schema version.
 *
 * `sizeBytes` covers only the main database file (`PRAGMA page_count *
 * PRAGMA page_size`); it does not include the `-wal` or `-shm` companion
 * files SQLite keeps alongside it under WAL journaling. It is `null` when the
 * database is open but could not be measured, and absent altogether from a
 * snapshot taken without a connection to measure — a size is a readout of a
 * live database rather than a property every snapshot has.
 */
export interface DatabaseHealthSnapshot {
	error?: string;
	path: string;
	schemaVersion: number;
	sizeBytes?: number | null;
	status: DatabaseStatus;
}

/**
 * Result of running `VACUUM` against the local database to reclaim the disk
 * space retention frees onto SQLite's internal freelist. `sizeBytesBefore` and
 * `sizeBytesAfter` follow the same main-file-only scope as
 * {@link DatabaseHealthSnapshot.sizeBytes}.
 */
export interface CompactDatabaseResult {
	durationMs: number;
	sizeBytesAfter: number | null;
	sizeBytesBefore: number | null;
}

/** Overall process and database health snapshot returned by the health IPC channel. */
export interface HealthSnapshot {
	appName: string;
	config: ConfigStatusSnapshot;
	database: DatabaseHealthSnapshot;
	platform: string;
	status: 'ok';
	timestamp: string;
	versions: {
		chrome: string;
		electron: string;
		node: string;
	};
}

/** Process / database health IPC surface. */
export interface HealthApi {
	/** Runs `VACUUM` against the local database, blocking until it completes. */
	compactDatabase: () => Promise<CompactDatabaseResult>;
	health: () => Promise<HealthSnapshot>;
	/** Subscribes to `config.json` reloads after external edits; returns an unsubscribe fn. */
	onConfigChanged: (
		listener: (event: ConfigChangedBroadcast) => void,
	) => () => void;
}
